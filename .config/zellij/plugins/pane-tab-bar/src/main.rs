use std::collections::BTreeMap;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};
use zellij_tile::prelude::*;

const PANE_SEPARATOR: &str = "  ";
const REFRESH_INTERVAL_SECONDS: f64 = 0.04;
const MAX_TITLE_WIDTH: usize = 30;
const MIN_TITLE_WIDTH: usize = 8;
const ELLIPSIS: &str = "…";

/// How much of each pane the bar shows. A tab starts at `Full` and steps down
/// until the bar fits its width.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Detail {
    Full,
    Capped(usize),
    Command,
    Marker,
}

fn detail_below(detail: Detail) -> Option<Detail> {
    match detail {
        Detail::Full => Some(Detail::Capped(MAX_TITLE_WIDTH)),
        Detail::Capped(width) if width > MIN_TITLE_WIDTH => {
            Some(Detail::Capped((width - 2).max(MIN_TITLE_WIDTH)))
        }
        Detail::Capped(_) => Some(Detail::Command),
        Detail::Command => Some(Detail::Marker),
        Detail::Marker => None,
    }
}

#[derive(Default)]
struct State {
    tabs: Vec<TabInfo>,
    panes: PaneManifest,
    mode_info: ModeInfo,
    tab_ranges: Vec<(usize, usize, u32)>,
    new_tab_range: Option<(usize, usize)>,
    visible: bool,
    refresh_scheduled: bool,
}

register_plugin!(State);

impl State {
    fn schedule_refresh(&mut self) {
        if self.visible && !self.refresh_scheduled {
            set_timeout(REFRESH_INTERVAL_SECONDS);
            self.refresh_scheduled = true;
        }
    }

    fn refresh_titles(&mut self) -> bool {
        let mut changed = false;
        for panes in self.panes.panes.values_mut() {
            for pane in panes.iter_mut().filter(|pane| !pane.is_plugin) {
                let Some(current) = get_pane_info(PaneId::Terminal(pane.id)) else {
                    continue;
                };
                if pane.title != current.title {
                    pane.title = current.title;
                    changed = true;
                }
            }
        }
        changed
    }

    fn tab_title(&self, tab: &TabInfo, detail: Detail) -> String {
        let Some(tab_panes) = self.panes.panes.get(&tab.position) else {
            return tab.name.clone();
        };
        pane_title(tab, tab_panes, detail)
    }

    /// Picks a detail level for each tab so the ribbons fit in `available`
    /// columns. A tab that is not active gives way first, widest first. The
    /// active tab gives way only when no other tab can shrink.
    fn tab_titles(&self, available: usize, padding: usize) -> Vec<String> {
        let mut details = vec![Detail::Full; self.tabs.len()];
        let mut titles: Vec<String> = self
            .tabs
            .iter()
            .map(|tab| self.tab_title(tab, Detail::Full))
            .collect();
        loop {
            let total: usize = titles.iter().map(|title| title.width() + 2 + padding).sum();
            if total <= available {
                break;
            }
            let Some(index) = self
                .widest_shrinkable(&titles, &details, false)
                .or_else(|| self.widest_shrinkable(&titles, &details, true))
            else {
                break;
            };
            let Some(below) = detail_below(details[index]) else {
                break;
            };
            details[index] = below;
            titles[index] = self.tab_title(&self.tabs[index], below);
        }
        titles
    }

    fn widest_shrinkable(
        &self,
        titles: &[String],
        details: &[Detail],
        include_active: bool,
    ) -> Option<usize> {
        (0..self.tabs.len())
            .filter(|&index| include_active || !self.tabs[index].active)
            .filter(|&index| detail_below(details[index]).is_some())
            .max_by_key(|&index| titles[index].width())
    }

    fn handle_mouse(&self, mouse: Mouse) {
        match mouse {
            Mouse::LeftClick(_, column) => {
                if self
                    .new_tab_range
                    .is_some_and(|(start, end)| column >= start && column < end)
                {
                    new_tab::<&str>(None, None);
                    return;
                }
                if let Some((_, _, tab_index)) = self
                    .tab_ranges
                    .iter()
                    .find(|(start, end, _)| column >= *start && column < *end)
                {
                    switch_tab_to(*tab_index);
                }
            }
            Mouse::ScrollUp(_) => {
                if let Some(active) = self.tabs.iter().position(|tab| tab.active) {
                    switch_tab_to((active + 2).min(self.tabs.len()) as u32);
                }
            }
            Mouse::ScrollDown(_) => {
                if let Some(active) = self.tabs.iter().position(|tab| tab.active) {
                    switch_tab_to(active.max(1) as u32);
                }
            }
            _ => {}
        }
    }
}

impl ZellijPlugin for State {
    fn load(&mut self, _configuration: BTreeMap<String, String>) {
        self.visible = true;
        request_permission(&[
            PermissionType::ReadApplicationState,
            PermissionType::ChangeApplicationState,
        ]);
        subscribe(&[
            EventType::TabUpdate,
            EventType::PaneUpdate,
            EventType::ModeUpdate,
            EventType::Mouse,
            EventType::Timer,
            EventType::Visible,
            EventType::PermissionRequestResult,
        ]);
        self.schedule_refresh();
    }

    fn update(&mut self, event: Event) -> bool {
        match event {
            Event::TabUpdate(tabs) => {
                self.tabs = tabs;
                true
            }
            Event::PaneUpdate(panes) => {
                self.panes = panes;
                true
            }
            Event::ModeUpdate(mode_info) => {
                self.mode_info = mode_info;
                true
            }
            Event::Mouse(mouse) => {
                self.handle_mouse(mouse);
                false
            }
            Event::Timer(_) => {
                self.refresh_scheduled = false;
                let changed = self.visible && self.refresh_titles();
                self.schedule_refresh();
                changed
            }
            Event::Visible(visible) => {
                self.visible = visible;
                self.schedule_refresh();
                visible
            }
            Event::PermissionRequestResult(PermissionStatus::Granted) => {
                set_selectable(false);
                true
            }
            Event::PermissionRequestResult(PermissionStatus::Denied) => true,
            _ => false,
        }
    }

    fn render(&mut self, _rows: usize, columns: usize) {
        self.tab_ranges.clear();
        self.new_tab_range = None;

        let session_name = self.mode_info.session_name.as_deref().unwrap_or_default();
        let prefix = if self.mode_info.style.hide_session_name || session_name.is_empty() {
            " Zellij ".to_string()
        } else {
            format!(" Zellij ({session_name}) ")
        };
        let mut output = serialize_text(&Text::new(&prefix));
        let mut column = prefix.width();
        let padding = ribbon_padding(self.mode_info.capabilities.arrow_fonts);

        let new_tab_width = " + ".width() + padding;
        let titles = self.tab_titles(columns.saturating_sub(column + new_tab_width), padding);
        for (tab, title) in self.tabs.iter().zip(titles) {
            let mut content = format!(" {title} ");
            let mut width = content.width() + padding;
            let cut = column + width > columns;
            if cut {
                let room = columns.saturating_sub(column + padding + 2);
                if room < ELLIPSIS.width() {
                    break;
                }
                content = format!(" {} ", truncate(&title, room));
                width = content.width() + padding;
            }
            let mut ribbon = Text::new(content);
            if tab.active {
                ribbon = ribbon.selected();
            }
            output.push_str(&serialize_ribbon(&ribbon));
            self.tab_ranges
                .push((column, column + width, (tab.position + 1) as u32));
            column += width;
            if cut {
                break;
            }
        }

        let new_tab = Text::new(" + ");
        if column + new_tab_width <= columns {
            output.push_str(&serialize_ribbon(&new_tab));
            self.new_tab_range = Some((column, column + new_tab_width));
        }

        let background = self.mode_info.style.colors.text_unselected.background;
        match background {
            PaletteColor::Rgb((red, green, blue)) => {
                print!("{output}\u{1b}[48;2;{red};{green};{blue}m\u{1b}[0K");
            }
            PaletteColor::EightBit(color) => {
                print!("{output}\u{1b}[48;5;{color}m\u{1b}[0K");
            }
        }
    }
}

/// The columns zellij adds around the text of a ribbon: one space on each
/// side, and with arrow fonts one arrow glyph on each side.
fn ribbon_padding(arrow_fonts: bool) -> usize {
    if arrow_fonts {
        4
    } else {
        2
    }
}

fn pane_title(tab: &TabInfo, panes: &[PaneInfo], detail: Detail) -> String {
    let mut panes: Vec<&PaneInfo> = panes
        .iter()
        .filter(|pane| !pane.is_plugin && !pane.exited)
        .collect();
    panes.sort_by_key(|pane| (pane.is_floating, pane.pane_y, pane.pane_x, pane.id));
    let focused_id = panes
        .iter()
        .find(|pane| pane.is_focused && pane.is_floating == tab.are_floating_panes_visible)
        .or_else(|| panes.iter().find(|pane| pane.is_focused))
        .map(|pane| pane.id);
    panes
        .into_iter()
        .map(|pane| {
            let marker = if focused_id == Some(pane.id) {
                "●"
            } else {
                "○"
            };
            pane_label(pane, marker, detail)
        })
        .collect::<Vec<_>>()
        .join(PANE_SEPARATOR)
}

fn pane_label(pane: &PaneInfo, marker: &str, detail: Detail) -> String {
    let label = match detail {
        Detail::Full => terminal_title(pane),
        Detail::Capped(width) => truncate(&terminal_title(pane), width),
        Detail::Command => {
            let capped = truncate(&terminal_title(pane), MIN_TITLE_WIDTH);
            let command = process_name(pane);
            if command.width() < capped.width() {
                command
            } else {
                capped
            }
        }
        Detail::Marker => return marker.to_string(),
    };
    format!("{marker} {label}")
}

fn terminal_title(pane: &PaneInfo) -> String {
    let title = pane.title.trim();
    if title.is_empty() {
        process_name(pane)
    } else {
        title.to_string()
    }
}

fn process_name(pane: &PaneInfo) -> String {
    pane.terminal_command
        .as_deref()
        .and_then(|command| command.rsplit('/').next())
        .filter(|command| !command.is_empty())
        .unwrap_or("shell")
        .to_string()
}

fn truncate(text: &str, max_width: usize) -> String {
    if text.width() <= max_width {
        return text.to_string();
    }
    let budget = max_width.saturating_sub(ELLIPSIS.width());
    let mut out = String::new();
    let mut width = 0;
    for ch in text.chars() {
        let ch_width = ch.width().unwrap_or(0);
        if width + ch_width > budget {
            break;
        }
        out.push(ch);
        width += ch_width;
    }
    format!("{}{ELLIPSIS}", out.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claude_pane() -> PaneInfo {
        PaneInfo {
            id: 2,
            title: "Workspace creating skill and zellij tab".to_string(),
            terminal_command: Some("/opt/homebrew/bin/claude".to_string()),
            is_focused: true,
            pane_y: 1,
            ..Default::default()
        }
    }

    fn nvim_pane() -> PaneInfo {
        PaneInfo {
            id: 1,
            title: "nvim".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn marks_the_focused_pane() {
        let tab = TabInfo::default();
        let panes = [
            nvim_pane(),
            PaneInfo {
                title: "pi".to_string(),
                ..claude_pane()
            },
        ];

        assert_eq!(pane_title(&tab, &panes, Detail::Full), "○ nvim  ● pi");
    }

    #[test]
    fn shows_the_full_title_at_full_detail() {
        let tab = TabInfo::default();

        assert_eq!(
            pane_title(&tab, &[claude_pane()], Detail::Full),
            "● Workspace creating skill and zellij tab"
        );
    }

    #[test]
    fn caps_a_long_title_with_an_ellipsis() {
        let tab = TabInfo::default();

        assert_eq!(
            pane_title(&tab, &[claude_pane()], Detail::Capped(20)),
            "● Workspace creating…"
        );
    }

    #[test]
    fn leaves_a_short_title_whole_when_capped() {
        let tab = TabInfo::default();

        assert_eq!(
            pane_title(&tab, &[nvim_pane()], Detail::Capped(20)),
            "○ nvim"
        );
    }

    #[test]
    fn falls_back_to_the_process_name_when_it_is_shorter() {
        let tab = TabInfo::default();

        assert_eq!(
            pane_title(&tab, &[claude_pane()], Detail::Command),
            "● claude"
        );
    }

    #[test]
    fn keeps_a_short_title_over_a_longer_process_name() {
        let tab = TabInfo::default();
        let pane = PaneInfo {
            title: "pi".to_string(),
            terminal_command: Some("/usr/local/bin/python3".to_string()),
            ..claude_pane()
        };

        assert_eq!(pane_title(&tab, &[pane], Detail::Command), "● pi");
    }

    #[test]
    fn shows_only_markers_at_the_lowest_detail() {
        let tab = TabInfo::default();
        let panes = [nvim_pane(), claude_pane()];

        assert_eq!(pane_title(&tab, &panes, Detail::Marker), "○  ●");
    }

    #[test]
    fn steps_down_from_full_to_marker() {
        let mut levels = vec![Detail::Full];
        while let Some(below) = detail_below(*levels.last().unwrap()) {
            levels.push(below);
        }

        assert_eq!(levels[1], Detail::Capped(30));
        assert_eq!(levels[levels.len() - 3], Detail::Capped(8));
        assert_eq!(levels[levels.len() - 2], Detail::Command);
        assert_eq!(levels.last(), Some(&Detail::Marker));
    }

    fn state(tabs: Vec<(bool, Vec<PaneInfo>)>) -> State {
        let mut state = State::default();
        for (position, (active, panes)) in tabs.into_iter().enumerate() {
            state.tabs.push(TabInfo {
                position,
                active,
                ..Default::default()
            });
            state.panes.panes.insert(position, panes);
        }
        state
    }

    #[test]
    fn shows_every_title_in_full_when_the_bar_is_wide() {
        let state = state(vec![
            (true, vec![claude_pane()]),
            (false, vec![nvim_pane()]),
        ]);

        assert_eq!(
            state.tab_titles(200, 4),
            ["● Workspace creating skill and zellij tab", "○ nvim"]
        );
    }

    #[test]
    fn keeps_the_active_title_and_shrinks_the_other_tabs_first() {
        let other = PaneInfo {
            title: "Swift tests performance review".to_string(),
            ..claude_pane()
        };
        let state = state(vec![
            (false, vec![nvim_pane(), other]),
            (true, vec![claude_pane()]),
        ]);
        let active_width = "● Workspace creating skill and zellij tab".width() + 2 + 4;
        let markers_width = "○  ●".width() + 2 + 4;

        assert_eq!(
            state.tab_titles(active_width + markers_width, 4),
            ["○  ●", "● Workspace creating skill and zellij tab"]
        );
    }

    #[test]
    fn shrinks_the_active_tab_only_when_nothing_else_can() {
        let state = state(vec![
            (false, vec![nvim_pane()]),
            (true, vec![claude_pane()]),
        ]);

        assert_eq!(state.tab_titles(22, 4), ["○", "● claude"]);
    }

    fn pane(title: &str, focused: bool, y: usize) -> PaneInfo {
        PaneInfo {
            id: (y + 1) as u32,
            title: title.to_string(),
            is_focused: focused,
            pane_y: y,
            ..Default::default()
        }
    }

    #[test]
    fn fits_the_real_four_tab_session() {
        let state = state(vec![
            (
                false,
                vec![
                    pane("Pane #1", false, 0),
                    pane("nvim", false, 1),
                    pane("\u{f012c} pi", false, 2),
                    pane("\u{f0156} pi", true, 3),
                ],
            ),
            (
                false,
                vec![pane("\u{2733} Swift tests performance review", true, 0)],
            ),
            (
                true,
                vec![pane(
                    "\u{2834} Workspace creating skill and zellij tab",
                    true,
                    0,
                )],
            ),
            (
                false,
                vec![
                    pane("Pane #1", false, 0),
                    pane("\u{2838} Graph group persistence", true, 1),
                ],
            ),
        ]);

        let available = 115 - " Zellij (zjtest) ".width() - (" + ".width() + 4);
        let titles = state.tab_titles(available, 4);
        let total: usize = titles.iter().map(|t| t.width() + 2 + 4).sum();

        assert!(
            total <= available,
            "total {total} > available {available}: {titles:?}"
        );
    }

    #[test]
    fn counts_wide_characters_by_columns() {
        assert_eq!(truncate("日本語のタイトル", 7), "日本語…");
    }
}
