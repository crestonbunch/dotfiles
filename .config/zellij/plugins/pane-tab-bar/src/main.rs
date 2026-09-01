use std::collections::BTreeMap;
use unicode_width::UnicodeWidthStr;
use zellij_tile::prelude::*;

const PANE_SEPARATOR: &str = "  ";
const REFRESH_INTERVAL_SECONDS: f64 = 0.04;

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

    fn tab_title(&self, tab: &TabInfo) -> String {
        let Some(tab_panes) = self.panes.panes.get(&tab.position) else {
            return tab.name.clone();
        };
        pane_title(tab, tab_panes)
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
        let arrow_width = if self.mode_info.capabilities.arrow_fonts {
            0
        } else {
            2
        };

        for tab in &self.tabs {
            let title = self.tab_title(tab);
            let content = format!(" {title} ");
            let width = content.width() + arrow_width;
            let mut ribbon = Text::new(content);
            if tab.active {
                ribbon = ribbon.selected();
            }
            output.push_str(&serialize_ribbon(&ribbon));
            self.tab_ranges
                .push((column, column + width, (tab.position + 1) as u32));
            column += width;
        }

        let new_tab = Text::new(" + ");
        let new_tab_width = " + ".width() + arrow_width;
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

fn pane_title(tab: &TabInfo, panes: &[PaneInfo]) -> String {
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
            format!("{marker} {}", terminal_title(pane))
        })
        .collect::<Vec<_>>()
        .join(PANE_SEPARATOR)
}

fn terminal_title(pane: &PaneInfo) -> String {
    let title = pane.title.trim();
    if !title.is_empty() {
        return title.to_string();
    }
    pane.terminal_command
        .as_deref()
        .and_then(|command| command.rsplit('/').next())
        .filter(|command| !command.is_empty())
        .unwrap_or("shell")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_the_focused_pane() {
        let tab = TabInfo::default();
        let panes = [
            PaneInfo {
                id: 1,
                title: "nvim".to_string(),
                ..Default::default()
            },
            PaneInfo {
                id: 2,
                title: "pi".to_string(),
                is_focused: true,
                pane_y: 1,
                ..Default::default()
            },
        ];

        assert_eq!(pane_title(&tab, &panes), "○ nvim  ● pi");
    }
}
