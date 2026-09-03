use std::collections::BTreeMap;
use std::ops::Range;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};
use zellij_tile::prelude::*;

const PANE_SEPARATOR: &str = "  ";
const TIGHT_SEPARATOR: &str = " ";
const REFRESH_INTERVAL_SECONDS: f64 = 0.04;
const MAX_TITLE_WIDTH: usize = 30;
const MIN_TITLE_WIDTH: usize = 8;
const ELLIPSIS: &str = "…";
const UNKNOWN_TAB: &str = "·";
const ACTIVE_HEAD_START: usize = MAX_TITLE_WIDTH;

/// How much of each pane the bar shows. A tab starts at `Full` and steps down
/// until the bar fits its width.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Detail {
    Full,
    Capped(usize),
    Command,
    Markers,
    TightMarkers,
    Count,
}

fn detail_below(detail: Detail) -> Option<Detail> {
    match detail {
        Detail::Full => Some(Detail::Capped(MAX_TITLE_WIDTH)),
        Detail::Capped(width) if width > MIN_TITLE_WIDTH => {
            Some(Detail::Capped((width - 2).max(MIN_TITLE_WIDTH)))
        }
        Detail::Capped(_) => Some(Detail::Command),
        Detail::Command => Some(Detail::Markers),
        Detail::Markers => Some(Detail::TightMarkers),
        Detail::TightMarkers => Some(Detail::Count),
        Detail::Count => None,
    }
}

/// The labels one tab can show, widest first. A level that saves no columns is
/// dropped, so every step down buys space and the last entry is the narrowest
/// label the tab can ever draw.
fn ladder(tab: &TabInfo, panes: Option<&[PaneInfo]>) -> Vec<String> {
    let mut labels: Vec<String> = Vec::new();
    let mut detail = Some(Detail::Full);
    while let Some(current) = detail {
        let label = match panes {
            Some(panes) => pane_title(tab, panes, current),
            None => tab_name(tab, current),
        };
        if labels
            .last()
            .is_none_or(|last: &String| label.width() < last.width())
        {
            labels.push(label);
        }
        detail = detail_below(current);
    }
    labels
}

fn floor_width(ladder: &[String]) -> usize {
    ladder.last().map_or(0, |label| label.width())
}

/// The widest label the active tab holds before the bar spends columns on its
/// neighbours. The rungs run widest first, so the first one inside the head
/// start is the one to keep.
fn head_start_width(ladder: &[String]) -> usize {
    ladder
        .iter()
        .map(|label| label.width())
        .find(|&width| width <= ACTIVE_HEAD_START)
        .unwrap_or(0)
}

/// Widens one tab by a single step when the extra columns still fit.
fn promote(
    ladders: &[Vec<String>],
    steps: &mut [usize],
    total: &mut usize,
    budget: usize,
    index: usize,
) -> bool {
    if steps[index] == 0 {
        return false;
    }
    let gain = ladders[index][steps[index] - 1].width() - ladders[index][steps[index]].width();
    if *total + gain > budget {
        return false;
    }
    steps[index] -= 1;
    *total += gain;
    true
}

/// Picks a rung of each tab's ladder so the ribbons fit in `budget` columns.
/// Every tab starts at its narrowest label and is widened one step at a time,
/// so the result can never overflow. The active tab takes the first turns until
/// it holds a title, then it competes with the others on equal terms. Returns
/// `None` when even the narrowest labels do not fit.
fn fit(
    ladders: &[Vec<String>],
    active: usize,
    budget: usize,
    cost: usize,
) -> Option<Vec<usize>> {
    if ladders.is_empty() {
        return Some(Vec::new());
    }
    let mut steps: Vec<usize> = ladders.iter().map(|ladder| ladder.len() - 1).collect();
    let mut total: usize = ladders.iter().map(|l| floor_width(l) + cost).sum();
    if total > budget {
        return None;
    }
    while steps[active] > 0
        && ladders[active][steps[active] - 1].width() <= ACTIVE_HEAD_START
        && promote(ladders, &mut steps, &mut total, budget, active)
    {}
    loop {
        let mut moved = false;
        for index in 0..ladders.len() {
            moved |= promote(ladders, &mut steps, &mut total, budget, index);
        }
        if !moved {
            return Some(steps);
        }
    }
}

/// The tabs to draw when even the narrowest labels of every tab do not fit.
/// The window grows outward from the active tab and reserves room for the
/// ellipsis ribbon that stands for the tabs on each elided side.
fn keep_window(ladders: &[Vec<String>], active: usize, budget: usize, cost: usize) -> Range<usize> {
    let elision = ELLIPSIS.width() + cost;
    let reserve = |start: usize, end: usize| {
        usize::from(start > 0) * elision + usize::from(end < ladders.len()) * elision
    };
    let width = |index: usize| floor_width(&ladders[index]) + cost;

    let mut start = active;
    let mut end = active + 1;
    let mut used = head_start_width(&ladders[active]) + cost;
    if used > budget {
        used = width(active);
    }
    loop {
        let mut grew = false;
        if end < ladders.len() && used + width(end) + reserve(start, end + 1) <= budget {
            used += width(end);
            end += 1;
            grew = true;
        }
        if start > 0 && used + width(start - 1) + reserve(start - 1, end) <= budget {
            start -= 1;
            used += width(start);
            grew = true;
        }
        if !grew {
            return start..end;
        }
    }
}

struct Layout {
    prefix: String,
    window: Range<usize>,
    steps: Vec<usize>,
    elide: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    Prefix,
    Tab(usize),
    Elision,
    NewTab,
}

/// One drawn run of the bar, with the columns it occupies. The bar draws and
/// hit tests the same segments, so a click always lands on what it points at.
struct Segment {
    text: String,
    kind: Kind,
    start: usize,
    width: usize,
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

    fn ladders(&self) -> Vec<Vec<String>> {
        self.tabs
            .iter()
            .map(|tab| ladder(tab, self.panes.panes.get(&tab.position).map(Vec::as_slice)))
            .collect()
    }

    /// The session prefix, richest first. The bar gives up the session name and
    /// then the whole prefix before it starts to hide tabs.
    fn prefixes(&self) -> Vec<String> {
        let session = self.mode_info.session_name.as_deref().unwrap_or_default();
        if self.mode_info.style.hide_session_name || session.is_empty() {
            vec![" Zellij ".to_string(), String::new()]
        } else {
            vec![
                format!(" Zellij ({session}) "),
                " Zellij ".to_string(),
                String::new(),
            ]
        }
    }

    /// Chooses the widest arrangement that fits in `limit` columns. The bar
    /// gives way in this order: the session name, the prefix, the new tab
    /// ribbon, and last the tabs furthest from the active one. Chrome outranks
    /// title width, so in the one or two columns where an arrangement flips a
    /// tab can lose a step to make room for the prefix or the new tab ribbon.
    fn layout(
        &self,
        ladders: &[Vec<String>],
        limit: usize,
        cost: usize,
        new_tab_width: usize,
    ) -> Layout {
        let active = self.tabs.iter().position(|tab| tab.active).unwrap_or(0);

        for keep_new_tab in [true, false] {
            for prefix in self.prefixes() {
                let reserved = prefix.width() + usize::from(keep_new_tab) * new_tab_width;
                let budget = limit.saturating_sub(reserved);
                if let Some(steps) = fit(ladders, active, budget, cost) {
                    return Layout {
                        prefix,
                        window: 0..ladders.len(),
                        steps,
                        elide: false,
                    };
                }
            }
        }

        let window = keep_window(ladders, active, limit, cost);
        let elision = ELLIPSIS.width() + cost;
        let kept = &ladders[window.clone()];
        let reserved = usize::from(window.start > 0) * elision
            + usize::from(window.end < ladders.len()) * elision;
        // An ellipsis that leaves no room for a tab says nothing. Give the
        // columns back to the tabs and let the bar end where it ends.
        let elide = fit(kept, active - window.start, limit.saturating_sub(reserved), cost).is_some();
        let steps = fit(
            kept,
            active - window.start,
            limit.saturating_sub(if elide { reserved } else { 0 }),
            cost,
        )
        .unwrap_or_else(|| kept.iter().map(|ladder| ladder.len() - 1).collect());
        Layout {
            prefix: String::new(),
            window,
            steps,
            elide,
        }
    }

    /// Lays the bar out into the columns it draws. Nothing is emitted past
    /// `columns`, whatever the width estimates say.
    fn segments(&self, columns: usize) -> Vec<Segment> {
        let padding = ribbon_padding(self.mode_info.capabilities);
        let cost = ribbon_cost(padding);
        let new_tab_width = " + ".width() + padding;
        // The bar is one row, so a line that wraps scrolls out of view and
        // leaves the row blank. Zellij measures with the same unicode-width
        // version as this plugin, but a terminal set to draw East Asian
        // Ambiguous glyphs double width does not, so keep a column in hand.
        let limit = columns.saturating_sub(1);

        let ladders = self.ladders();
        let layout = self.layout(&ladders, limit, cost, new_tab_width);

        let mut segments: Vec<Segment> = Vec::new();
        let mut column = layout.prefix.width();
        if column > 0 && column <= limit {
            segments.push(Segment {
                text: layout.prefix,
                kind: Kind::Prefix,
                start: 0,
                width: column,
            });
        } else {
            column = 0;
        }

        let ribbon = |segments: &mut Vec<Segment>, column: &mut usize, text: &str, kind| {
            let width = text.width() + cost;
            if *column + width > limit {
                return false;
            }
            segments.push(Segment {
                text: text.to_string(),
                kind,
                start: *column,
                width,
            });
            *column += width;
            true
        };

        if layout.elide && layout.window.start > 0 {
            ribbon(&mut segments, &mut column, ELLIPSIS, Kind::Elision);
        }
        for (offset, &step) in layout.steps.iter().enumerate() {
            let index = layout.window.start + offset;
            if !ribbon(
                &mut segments,
                &mut column,
                &ladders[index][step],
                Kind::Tab(index),
            ) {
                break;
            }
        }
        if layout.elide && layout.window.end < ladders.len() {
            ribbon(&mut segments, &mut column, ELLIPSIS, Kind::Elision);
        }
        ribbon(&mut segments, &mut column, "+", Kind::NewTab);
        segments
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
        let segments = self.segments(columns);

        self.tab_ranges = segments
            .iter()
            .filter_map(|segment| match segment.kind {
                Kind::Tab(index) => Some((
                    segment.start,
                    segment.start + segment.width,
                    (self.tabs[index].position + 1) as u32,
                )),
                _ => None,
            })
            .collect();
        self.new_tab_range = segments
            .iter()
            .find(|segment| segment.kind == Kind::NewTab)
            .map(|segment| (segment.start, segment.start + segment.width));

        let mut output = String::new();
        for segment in &segments {
            if segment.kind == Kind::Prefix {
                output.push_str(&serialize_text(&Text::new(&segment.text)));
                continue;
            }
            let mut ribbon = Text::new(format!(" {} ", segment.text));
            if matches!(segment.kind, Kind::Tab(index) if self.tabs[index].active) {
                ribbon = ribbon.selected();
            }
            output.push_str(&serialize_ribbon(&ribbon));
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

/// The columns zellij adds around the text of a ribbon: one space on each side,
/// plus one arrow glyph on each side when it draws arrows. `arrow_fonts` is
/// inverted in the plugin API: zellij sets it to true for a simplified UI,
/// which is the case where it draws no arrows.
fn ribbon_padding(capabilities: PluginCapabilities) -> usize {
    if capabilities.arrow_fonts {
        2
    } else {
        4
    }
}

/// The columns a ribbon costs beyond its label: the padding zellij draws, plus
/// the space the bar puts on each side of the label.
fn ribbon_cost(padding: usize) -> usize {
    padding + 2
}

fn tab_name(tab: &TabInfo, detail: Detail) -> String {
    match detail {
        Detail::Full => tab.name.clone(),
        Detail::Capped(width) => truncate(&tab.name, width),
        Detail::Command => truncate(&tab.name, MIN_TITLE_WIDTH),
        _ => UNKNOWN_TAB.to_string(),
    }
}

fn pane_title(tab: &TabInfo, panes: &[PaneInfo], detail: Detail) -> String {
    let mut panes: Vec<&PaneInfo> = panes
        .iter()
        .filter(|pane| !pane.is_plugin && !pane.exited)
        .collect();
    if detail == Detail::Count {
        return panes.len().to_string();
    }
    panes.sort_by_key(|pane| (pane.is_floating, pane.pane_y, pane.pane_x, pane.id));
    let focused_id = panes
        .iter()
        .find(|pane| pane.is_focused && pane.is_floating == tab.are_floating_panes_visible)
        .or_else(|| panes.iter().find(|pane| pane.is_focused))
        .map(|pane| pane.id);
    let separator = if detail == Detail::TightMarkers {
        TIGHT_SEPARATOR
    } else {
        PANE_SEPARATOR
    };
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
        .join(separator)
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
        Detail::Markers | Detail::TightMarkers | Detail::Count => return marker.to_string(),
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

    fn pane(title: &str, focused: bool, y: usize) -> PaneInfo {
        PaneInfo {
            id: (y + 1) as u32,
            title: title.to_string(),
            is_focused: focused,
            pane_y: y,
            ..Default::default()
        }
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

    fn with_session(mut state: State, name: &str, arrows: bool) -> State {
        state.mode_info.session_name = Some(name.to_string());
        state.mode_info.capabilities = PluginCapabilities {
            arrow_fonts: !arrows,
        };
        state
    }

    fn drawn_width(state: &State, columns: usize) -> usize {
        state
            .segments(columns)
            .last()
            .map_or(0, |segment| segment.start + segment.width)
    }

    fn fixtures() -> Vec<(&'static str, State)> {
        let long = "\u{2834} Workspace creating skill and zellij tab";
        vec![
            ("no tabs", State::default()),
            ("one tab one pane", state(vec![(true, vec![claude_pane()])])),
            (
                "twelve panes",
                state(vec![(
                    true,
                    (0..12).map(|i| pane("some pane title", i == 3, i)).collect(),
                )]),
            ),
            (
                "the four tab session",
                state(vec![
                    (
                        false,
                        vec![
                            pane("nvim", false, 0),
                            pane("Sidebar controls width overflow", false, 1),
                            pane("Pane #3", false, 2),
                            pane("Pane #4", true, 3),
                        ],
                    ),
                    (false, vec![pane("\u{2733} Swift tests review", true, 0)]),
                    (true, vec![pane(long, true, 0)]),
                    (
                        false,
                        vec![pane("Pane #1", false, 0), pane("Graph group", true, 1)],
                    ),
                ]),
            ),
            (
                "twenty tabs",
                state(
                    (0..20)
                        .map(|i| (i == 11, vec![pane("a fairly long pane title", true, 0)]))
                        .collect(),
                ),
            ),
            (
                "a two hundred column title",
                state(vec![(true, vec![pane(&"x".repeat(200), true, 0)])]),
            ),
            (
                "wide characters",
                state(vec![
                    (true, vec![pane("\u{65e5}\u{672c}\u{8a9e}\u{306e}\u{30bf}\u{30a4}\u{30c8}\u{30eb}", true, 0)]),
                    (false, vec![pane("\u{4e2d}\u{6587}\u{6807}\u{9898}", true, 0)]),
                ]),
            ),
        ]
    }

    fn empty_manifest_fixture() -> State {
        let mut state = State::default();
        state.tabs.push(TabInfo {
            position: 0,
            active: true,
            name: "a tab with no pane manifest yet".to_string(),
            ..Default::default()
        });
        state
    }

    #[test]
    fn the_bar_never_exceeds_the_terminal_width() {
        for arrows in [true, false] {
            for (name, fixture) in fixtures() {
                let state = with_session(fixture, "fotometis", arrows);
                for columns in 0..=400 {
                    let drawn = drawn_width(&state, columns);
                    assert!(
                        drawn <= columns,
                        "{name}, arrows {arrows}, columns {columns}: drew {drawn} columns"
                    );
                }
            }
        }
    }

    #[test]
    fn a_tab_with_no_pane_manifest_still_fits() {
        let state = with_session(empty_manifest_fixture(), "fotometis", true);

        for columns in 0..=400 {
            let drawn = drawn_width(&state, columns);
            assert!(drawn <= columns, "columns {columns}: drew {drawn} columns");
        }
    }

    #[test]
    fn the_active_tab_stays_on_the_bar_from_the_width_that_holds_one_ribbon() {
        let state = with_session(fixtures().remove(3).1, "fotometis", true);
        let active = state.tabs.iter().position(|tab| tab.active).unwrap();

        for columns in 8..=400 {
            let drawn = state
                .segments(columns)
                .iter()
                .any(|segment| segment.kind == Kind::Tab(active));
            assert!(drawn, "columns {columns}: the active tab was not drawn");
        }
    }

    #[test]
    fn the_bar_never_shows_an_ellipsis_without_a_tab() {
        for arrows in [true, false] {
            for (name, fixture) in fixtures() {
                let state = with_session(fixture, "fotometis", arrows);
                for columns in 0..=400 {
                    let segments = state.segments(columns);
                    if !segments.iter().any(|s| s.kind == Kind::Elision) {
                        continue;
                    }
                    assert!(
                        segments.iter().any(|s| matches!(s.kind, Kind::Tab(_))),
                        "{name}, arrows {arrows}, columns {columns}: an ellipsis stood alone"
                    );
                }
            }
        }
    }

    #[test]
    fn a_narrow_bar_keeps_the_active_title_over_one_more_neighbour() {
        let state = with_session(
            state(
                (0..8)
                    .map(|i| (i == 4, vec![pane("a long pane title", true, 0)]))
                    .collect(),
            ),
            "fotometis",
            true,
        );

        let active = state
            .segments(40)
            .into_iter()
            .find(|segment| segment.kind == Kind::Tab(4))
            .expect("the active tab is drawn");

        assert!(
            active.text.width() > 1,
            "the active tab fell to its pane count: {:?}",
            active.text
        );
    }

    #[test]
    fn twenty_tabs_keep_the_active_tab_and_elide_the_rest() {
        let state = with_session(
            state(
                (0..20)
                    .map(|i| (i == 11, vec![pane("a long pane title", true, 0)]))
                    .collect(),
            ),
            "fotometis",
            true,
        );

        let segments = state.segments(60);
        let kinds: Vec<Kind> = segments.iter().map(|segment| segment.kind).collect();

        assert!(kinds.contains(&Kind::Tab(11)), "kinds: {kinds:?}");
        assert!(kinds.contains(&Kind::Elision), "kinds: {kinds:?}");
    }

    #[test]
    fn click_ranges_are_ordered_and_match_the_drawn_ribbons() {
        let state = with_session(fixtures().remove(3).1, "fotometis", true);

        for columns in 0..=400 {
            let segments = state.segments(columns);
            let mut column = 0;
            for segment in &segments {
                assert_eq!(
                    segment.start, column,
                    "columns {columns}: segment {:?} starts at {} not {column}",
                    segment.kind, segment.start
                );
                column += segment.width;
            }
            assert!(column <= columns, "columns {columns}: drew {column}");
        }
    }

    #[test]
    fn the_session_name_drops_before_a_tab_loses_its_ribbon() {
        let state = with_session(fixtures().remove(3).1, "a-very-long-session-name", true);
        let segments = state.segments(70);
        let prefix = segments
            .iter()
            .find(|segment| segment.kind == Kind::Prefix)
            .map(|segment| segment.text.as_str());
        let tabs = segments
            .iter()
            .filter(|segment| matches!(segment.kind, Kind::Tab(_)))
            .count();

        assert_eq!(prefix, Some(" Zellij "));
        assert_eq!(tabs, 4);
    }

    fn tab_label_widths(state: &State, columns: usize) -> Vec<usize> {
        state
            .segments(columns)
            .iter()
            .filter(|segment| matches!(segment.kind, Kind::Tab(_)))
            .map(|segment| segment.text.width())
            .collect()
    }

    #[test]
    fn a_wider_terminal_never_drops_a_tab() {
        let state = with_session(fixtures().remove(3).1, "fotometis", true);
        let mut previous = 0;

        for columns in 0..=400 {
            let drawn = tab_label_widths(&state, columns).len();
            assert!(
                drawn >= previous,
                "columns {columns}: drew {drawn} tabs after {previous}"
            );
            previous = drawn;
        }
    }

    #[test]
    fn a_ribbon_costs_four_columns_when_zellij_draws_arrows() {
        assert_eq!(ribbon_padding(PluginCapabilities { arrow_fonts: false }), 4);
        assert_eq!(ribbon_padding(PluginCapabilities { arrow_fonts: true }), 2);
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

        assert_eq!(pane_title(&tab, &[nvim_pane()], Detail::Capped(20)), "○ nvim");
    }

    #[test]
    fn falls_back_to_the_process_name_when_it_is_shorter() {
        let tab = TabInfo::default();

        assert_eq!(pane_title(&tab, &[claude_pane()], Detail::Command), "● claude");
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
    fn shows_only_markers_at_the_marker_detail() {
        let tab = TabInfo::default();
        let panes = [nvim_pane(), claude_pane()];

        assert_eq!(pane_title(&tab, &panes, Detail::Markers), "○  ●");
    }

    #[test]
    fn drops_a_space_between_markers_at_the_tight_detail() {
        let tab = TabInfo::default();
        let panes = [nvim_pane(), claude_pane()];

        assert_eq!(pane_title(&tab, &panes, Detail::TightMarkers), "○ ●");
    }

    #[test]
    fn shows_the_pane_count_at_the_lowest_detail() {
        let tab = TabInfo::default();
        let panes = [nvim_pane(), claude_pane()];

        assert_eq!(pane_title(&tab, &panes, Detail::Count), "2");
    }

    #[test]
    fn steps_down_from_full_to_the_pane_count() {
        let mut levels = vec![Detail::Full];
        while let Some(below) = detail_below(*levels.last().unwrap()) {
            levels.push(below);
        }

        assert_eq!(levels[1], Detail::Capped(30));
        assert_eq!(levels[levels.len() - 5], Detail::Capped(8));
        assert_eq!(levels[levels.len() - 4], Detail::Command);
        assert_eq!(levels[levels.len() - 3], Detail::Markers);
        assert_eq!(levels[levels.len() - 2], Detail::TightMarkers);
        assert_eq!(levels.last(), Some(&Detail::Count));
    }

    #[test]
    fn a_ladder_narrows_strictly_at_every_step() {
        let tab = TabInfo::default();
        let panes = vec![nvim_pane(), claude_pane()];
        let rungs = ladder(&tab, Some(&panes));

        for pair in rungs.windows(2) {
            assert!(
                pair[0].width() > pair[1].width(),
                "{:?} is not wider than {:?}",
                pair[0],
                pair[1]
            );
        }
        assert_eq!(rungs.last().map(String::as_str), Some("2"));
    }

    #[test]
    fn shows_every_title_in_full_when_the_bar_is_wide() {
        let state = state(vec![(true, vec![claude_pane()]), (false, vec![nvim_pane()])]);
        let titles: Vec<String> = state
            .segments(200)
            .into_iter()
            .filter(|segment| matches!(segment.kind, Kind::Tab(_)))
            .map(|segment| segment.text)
            .collect();

        assert_eq!(
            titles,
            ["● Workspace creating skill and zellij tab", "○ nvim"]
        );
    }

    #[test]
    fn counts_wide_characters_by_columns() {
        assert_eq!(truncate("日本語のタイトル", 7), "日本語…");
    }
}
