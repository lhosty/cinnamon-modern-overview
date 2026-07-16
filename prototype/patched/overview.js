// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const Meta = imports.gi.Meta;
const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Lang = imports.lang;
const St = imports.gi.St;
const Cinnamon = imports.gi.Cinnamon;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const Main = imports.ui.main;
const WorkspacesView = imports.ui.workspacesView;
const AppGrid = imports.ui.appGrid;
const SearchResults = imports.ui.searchResults;

// Workspace swipe duration. Overview visibility and view changes use their
// own tuned timings so input can reverse them without stacking transitions.
var ANIMATION_TIME = 250;
const OVERVIEW_SHOW_TIME = 285;
const OVERVIEW_HIDE_TIME = 180;
const VIEW_SWITCH_TIME = 175;
const VIEW_SWITCH_OUT_TIME = 115;
const MIN_REVERSAL_TIME = 70;
const SHORTCUT_DOUBLE_TAP_MS = 400;
const SHORTCUT_CLOSE_TIME = SHORTCUT_DOUBLE_TAP_MS;

// Modern top area: a large search pill plus a compact Janelas/Aplicativos
// switcher. All values are logical pixels and are clamped for narrow monitors.
const OVERVIEW_HEADER_HEIGHT = 132;
const SEARCH_BAR_ENTRY_TOP = 16;
const SEARCH_BAR_ENTRY_HEIGHT = 52;
const SEARCH_BAR_ENTRY_WIDTH = 680;
const VIEW_SWITCHER_TOP = 78;
const VIEW_SWITCHER_WIDTH = 248;
const VIEW_SWITCHER_HEIGHT = 38;
const SEARCH_RESULTS_MAX_WIDTH = 860;
const MAX_SEARCH_ACTIVATION_LENGTH = 512;

function _sanitizeSearchText(value) {
    let text = String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return text.slice(0, MAX_SEARCH_ACTIVATION_LENGTH);
}

const ViewMode = {
    WORKSPACES: 'workspaces',
    APPS: 'apps',
    SEARCH: 'search'
};

const SwipeScrollDirection = WorkspacesView.SwipeScrollDirection;
const SwipeScrollResult = WorkspacesView.SwipeScrollResult;

function Overview() {
    this._init.apply(this, arguments);
}

Overview.prototype = {
    _init : function() {
        this._group = new St.Widget({ name: 'overview',
                                      reactive: true });
        this._group._delegate = this;
        this._group.hide();
        global.overlay_group.add_actor(this._group);

        this._scrollDirection = SwipeScrollDirection.NONE;
        this._scrollAdjustment = null;
        this._capturedEventId = 0;
        this._swipeEventActor = null;
        this._swipeReleaseWatchId = 0;
        this._swipeInProgress = false;
        this._swipeStartMonotonicMs = 0;
        this._lastMotionMonotonicMs = 0;
        this._buttonPressId = 0;
        this._stageKeyPressId = 0;
        this._stageTabCaptureId = 0;
        this._focusIdleId = 0;
        this._shortcutTimeoutId = 0;
        this._shortcutLastActivationMs = 0;
        this._shortcutPending = false;
        this._shortcutGeneration = 0;
        this._teardownIdleId = 0;
        this._teardownGeneration = 0;

        this.visible = false;           // animating to overview, in overview, animating out
        this._shown = false;            // show() and not hide()
        this._shownTemporarily = false; // showTemporarily() and not hideTemporarily()
        this._modal = false;            // have a modal grab
        this.animationInProgress = false;
        this._hideInProgress = false;
        this._animationGeneration = 0;
        this._viewAnimationGeneration = 0;

        // _requestedViewMode survives close/open animation boundaries. This is
        // what lets a second Super tap reopen directly in the application grid.
        this._requestedViewMode = ViewMode.WORKSPACES;
        this._viewMode = ViewMode.WORKSPACES;
        this._viewBeforeSearch = ViewMode.WORKSPACES;

        // Kept as compatibility flags for code outside this module.
        this.isAppGridVisible = false;
        this.isSearchVisible = false;
        this._ignoreSearchChange = false;

        this._viewSwitcher = null;
        this._workspaceViewButton = null;
        this._appsViewButton = null;
    },

    init: function() {
        Main.layoutManager.connect('monitors-changed', Lang.bind(this, this.hide));
    },

    setScrollAdjustment: function(adjustment, direction) {
        if (!adjustment && this._swipeInProgress)
            this.cancelWorkspaceSwipe();

        this._scrollAdjustment = adjustment;
        if (this._scrollAdjustment == null)
            this._scrollDirection = SwipeScrollDirection.NONE;
        else
            this._scrollDirection = direction;
    },

    _disconnectCapturedSwipeHandler: function() {
        if (this._swipeReleaseWatchId) {
            Mainloop.source_remove(this._swipeReleaseWatchId);
            this._swipeReleaseWatchId = 0;
        }

        if (this._capturedEventId && this._swipeEventActor) {
            try {
                this._swipeEventActor.disconnect(this._capturedEventId);
            } catch (e) {}
        }

        this._capturedEventId = 0;
        this._swipeEventActor = null;
    },

    _finishWorkspaceSwipe: function(result, targetValue) {
        if (!this._swipeInProgress)
            return;

        this._swipeInProgress = false;
        this._swipeStartMonotonicMs = 0;
        this._lastMotionMonotonicMs = 0;
        if (this._coverPane && !this._hideInProgress)
            this._coverPane.hide();
        this.emit('swipe-scroll-end', result, targetValue);
    },

    cancelWorkspaceSwipe: function() {
        let hadSwipe = this._swipeInProgress || !!this._capturedEventId;
        let targetValue = null;

        if (this._scrollAdjustment) {
            let minimum = Number(this._scrollAdjustment.lower || 0);
            let maximum = Number(
                this._scrollAdjustment.upper -
                this._scrollAdjustment.page_size
            );
            targetValue = Math.round(
                Number(this._dragStartValue !== undefined
                    ? this._dragStartValue
                    : this._scrollAdjustment.value || 0)
            );
            targetValue = Math.max(
                minimum,
                Math.min(maximum, targetValue)
            );
        }

        this._disconnectCapturedSwipeHandler();

        if (hadSwipe)
            this._finishWorkspaceSwipe(
                SwipeScrollResult.CANCEL,
                targetValue
            );
    },

    _eventBlocksWorkspaceSwipe: function(event) {
        let source = null;
        try {
            source = event.get_source();
        } catch (e) {}

        while (source) {
            if (source._overviewWindowActor)
                return true;
            if (source._delegate && source._delegate.metaWindow)
                return true;
            if (source === this.searchEntry ||
                source === this._viewSwitcher ||
                source === this.appGrid?.actor ||
                source === this.searchResultsPanel?.actor)
                return true;
            if (source === this._group)
                break;
            source = source.get_parent ? source.get_parent() : null;
        }

        return false;
    },

    _armWorkspaceSwipeReleaseWatch: function() {
        if (this._swipeReleaseWatchId)
            Mainloop.source_remove(this._swipeReleaseWatchId);

        // Captured-event is reliable for movement on this Cinnamon generation,
        // but a release can be lost when the pointer crosses reactive actors.
        // Polling the physical button state gives us an independent, bounded
        // completion path without grabbing the pointer away from the workspace.
        this._swipeReleaseWatchId = Mainloop.timeout_add(32, () => {
            if (!this._swipeInProgress) {
                this._swipeReleaseWatchId = 0;
                return false;
            }

            let x, y, mask;
            try {
                [x, y, mask] = global.get_pointer();
            } catch (e) {
                return true;
            }

            if (!(mask & Clutter.ModifierType.BUTTON1_MASK)) {
                this._swipeReleaseWatchId = 0;
                this._completeWorkspaceSwipe(
                    x,
                    y,
                    GLib.get_monotonic_time() / 1000
                );
                return false;
            }

            return true;
        });
    },

    beginWorkspaceSwipe: function(event, trustedSurface) {
        if (!event)
            return false;

        this.emit('overview-background-button-press', this._group, event);

        if (this._scrollDirection == SwipeScrollDirection.NONE ||
            !this._scrollAdjustment ||
            event.get_button() != 1 ||
            this._viewMode !== ViewMode.WORKSPACES ||
            this._hideInProgress)
            return false;

        // Window clones and interactive header elements keep their own input.
        // The per-workspace drop rectangle is an explicitly trusted empty
        // surface, so it bypasses actor-ancestry heuristics that vary by theme.
        if (!trustedSurface && this._eventBlocksWorkspaceSwipe(event))
            return false;

        if (this._swipeInProgress)
            return true;

        this.cancelWorkspaceSwipe();
        try {
            this._scrollAdjustment.remove_all_transitions();
        } catch (e) {}

        let [stageX, stageY] = event.get_coords();
        this._dragStartX = this._dragX = stageX;
        this._dragStartY = this._dragY = stageY;
        this._dragStartValue = this._scrollAdjustment.value;
        this._lastMotionTime = -1;
        this._swipeStartMonotonicMs = GLib.get_monotonic_time() / 1000;
        this._lastMotionMonotonicMs = this._swipeStartMonotonicMs;
        this._swipeInProgress = true;

        // Capture motion at the stage, but start the gesture directly from the
        // empty workspace surface. This avoids relying on event bubbling from
        // the reactive DND drop rectangle to the Overview container.
        this._swipeEventActor = global.stage;
        this._capturedEventId = global.stage.connect(
            'captured-event',
            Lang.bind(this, this._onCapturedEvent)
        );
        this._armWorkspaceSwipeReleaseWatch();

        this.emit('swipe-scroll-begin');
        return true;
    },

    _onButtonPress: function(actor, event) {
        return this.beginWorkspaceSwipe(event, false);
    },

    _completeWorkspaceSwipe: function(stageX, stageY, nowMs) {
        if (!this._swipeInProgress || !this._scrollAdjustment)
            return false;

        let threshold = Gtk.Settings.get_default().gtk_dnd_drag_threshold;
        let minValue = Number(this._scrollAdjustment.lower || 0);
        let maxValue = Number(
            this._scrollAdjustment.upper - this._scrollAdjustment.page_size
        );
        let horizontal = this._scrollDirection ==
            SwipeScrollDirection.HORIZONTAL;
        let primaryDelta = horizontal
            ? stageX - this._dragStartX
            : stageY - this._dragStartY;
        let crossDelta = horizontal
            ? stageY - this._dragStartY
            : stageX - this._dragStartX;
        let direction = primaryDelta > 0 ? -1 : 1;

        if (horizontal &&
            St.Widget.get_default_direction() == St.TextDirection.RTL)
            direction *= -1;

        let difference = direction * this._scrollAdjustment.page_size;
        if (this._dragStartValue + difference > maxValue)
            difference = maxValue - this._dragStartValue;
        else if (this._dragStartValue + difference < minValue)
            difference = minValue - this._dragStartValue;

        let adjustmentDistance = Math.abs(
            Number(this._scrollAdjustment.value) - this._dragStartValue
        );
        let pageDistance = Math.abs(Number(difference));
        let progress = pageDistance > 0
            ? adjustmentDistance / pageDistance
            : 0;
        let elapsedSeconds = Math.max(
            0.001,
            (nowMs - this._swipeStartMonotonicMs) / 1000
        );
        let velocity = Math.abs(primaryDelta) / elapsedSeconds;
        let monitor = Main.layoutManager.primaryMonitor;
        try {
            let monitorIndex = Main.layoutManager.findMonitorIndexAt(
                stageX,
                stageY
            );
            monitor = Main.layoutManager.monitors[monitorIndex] || monitor;
        } catch (e) {}
        let monitorSize = horizontal ? monitor.width : monitor.height;
        let displacementThreshold = Math.max(
            threshold * 3,
            monitorSize * 0.14
        );
        let moved = Math.abs(primaryDelta) >= threshold ||
                    Math.abs(crossDelta) >= threshold;
        let shouldCommit = difference !== 0 &&
            (progress >= 0.22 ||
             Math.abs(primaryDelta) >= displacementThreshold ||
             (Math.abs(primaryDelta) >= threshold * 2 && velocity >= 650));

        let result;
        let targetValue = this._dragStartValue;
        if (!moved) {
            result = SwipeScrollResult.CLICK;
        } else if (shouldCommit) {
            result = SwipeScrollResult.SWIPE;
            targetValue = this._dragStartValue + difference;
        } else {
            result = SwipeScrollResult.CANCEL;
        }

        targetValue = Math.max(minValue, Math.min(maxValue, targetValue));
        this._disconnectCapturedSwipeHandler();
        this._finishWorkspaceSwipe(result, targetValue);
        return result != SwipeScrollResult.CLICK;
    },

    _onCapturedEvent: function(actor, event) {
        let stageX, stageY;
        let threshold = Gtk.Settings.get_default().gtk_dnd_drag_threshold;

        switch(event.type()) {
            case Clutter.EventType.BUTTON_RELEASE:
                [stageX, stageY] = event.get_coords();
                return this._completeWorkspaceSwipe(
                    stageX,
                    stageY,
                    GLib.get_monotonic_time() / 1000
                );

            case Clutter.EventType.MOTION:
                [stageX, stageY] = event.get_coords();
                let dx = this._dragX - stageX;
                let dy = this._dragY - stageY;
                let monitorIndex = Main.layoutManager.findMonitorIndexAt(
                    stageX,
                    stageY
                );
                if (monitorIndex < 0)
                    monitorIndex = Main.layoutManager.primaryIndex;
                let monitor = Main.layoutManager.monitors[monitorIndex] ||
                    Main.layoutManager.primaryMonitor;

                this._dragX = stageX;
                this._dragY = stageY;
                this._lastMotionTime = event.get_time();
                this._lastMotionMonotonicMs =
                    GLib.get_monotonic_time() / 1000;

                if (Math.abs(stageX - this._dragStartX) < threshold &&
                    Math.abs(stageY - this._dragStartY) < threshold)
                    return true;

                let nextValue = this._scrollAdjustment.value;
                if (this._scrollDirection == SwipeScrollDirection.HORIZONTAL) {
                    if (St.Widget.get_default_direction() == St.TextDirection.RTL)
                        nextValue -= (dx / monitor.width) *
                            this._scrollAdjustment.page_size;
                    else
                        nextValue += (dx / monitor.width) *
                            this._scrollAdjustment.page_size;
                } else {
                    nextValue += (dy / monitor.height) *
                        this._scrollAdjustment.page_size;
                }

                let minimum = this._scrollAdjustment.lower;
                let maximum = this._scrollAdjustment.upper -
                    this._scrollAdjustment.page_size;
                this._scrollAdjustment.value = Math.max(
                    minimum,
                    Math.min(maximum, nextValue)
                );

                return true;

            case Clutter.EventType.ENTER:
            case Clutter.EventType.LEAVE:
                return true;
        }

        return false;
    },

    _focusSearchEntry: function() {
        if (!this.searchEntry)
            return false;

        try {
            this.searchEntry.clutter_text.grab_key_focus();
        } catch (e) {
            global.stage.set_key_focus(this.searchEntry.clutter_text);
        }
        try {
            this.searchEntry.clutter_text.set_cursor_position(-1);
        } catch (e) {}
        return true;
    },

    _focusViewBoundary: function(mode, boundary) {
        if (mode === ViewMode.APPS && this.appGrid) {
            return boundary === 'last'
                ? this.appGrid.focusLast()
                : this.appGrid.focusFirst();
        }

        if (mode === ViewMode.WORKSPACES)
            return this._focusWorkspacesView(boundary);

        return this._focusSearchEntry();
    },

    // Captured before WorkspacesView or an app button consumes Tab. Plain Tab
    // is reserved for switching between the two main overview surfaces;
    // Ctrl+Tab, Alt+Tab and Super+Tab remain available to the desktop.
    _onStageCapturedKeyEvent: function(actor, event) {
        if (!this.visible || !this._shown || this._hideInProgress ||
            event.type() !== Clutter.EventType.KEY_PRESS)
            return false;

        let symbol = event.get_key_symbol();
        if (symbol !== Clutter.KEY_Tab &&
            symbol !== Clutter.KEY_ISO_Left_Tab)
            return false;

        if (this._viewMode === ViewMode.SEARCH)
            return false;

        if (this.appGrid && this.appGrid.isContextMenuOpen &&
            this.appGrid.isContextMenuOpen())
            return false;

        let modifiers = Cinnamon.get_event_state(event);
        let superMask = Clutter.ModifierType.MOD4_MASK ||
                        Clutter.ModifierType.SUPER_MASK || 0;
        let reservedModifiers = Clutter.ModifierType.CONTROL_MASK |
                                Clutter.ModifierType.MOD1_MASK |
                                superMask;
        if (modifiers & reservedModifiers)
            return false;

        let reverse = symbol === Clutter.KEY_ISO_Left_Tab ||
                      !!(modifiers & Clutter.ModifierType.SHIFT_MASK);
        let target = this._viewMode === ViewMode.APPS
            ? ViewMode.WORKSPACES
            : ViewMode.APPS;
        let boundary = reverse ? 'last' : 'first';

        this._setBaseView(target, true);
        Mainloop.idle_add(() => {
            if (this._shown && this._viewMode === target)
                this._focusViewBoundary(target, boundary);
            return false;
        });
        return true;
    },

    _getActiveWorkspaceModel: function() {
        if (!this.workspacesView)
            return null;

        if (typeof this.workspacesView.getActiveWorkspace === 'function') {
            try {
                return this.workspacesView.getActiveWorkspace();
            } catch (e) {}
        }

        let index = global.workspace_manager.get_active_workspace_index();
        if (this.workspacesView._workspaces &&
            index >= 0 && index < this.workspacesView._workspaces.length)
            return this.workspacesView._workspaces[index];

        return null;
    },

    _getWorkspacesActor: function() {
        if (!this.workspacesView)
            return null;
        return this.workspacesView.actor || this.workspacesView;
    },

    _getActiveWorkspaceMonitor: function(workspace) {
        if (!workspace || !workspace._monitors ||
            workspace._monitors.length === 0)
            return null;

        let monitorIndex = typeof workspace.currentMonitorIndex === 'number'
            ? workspace.currentMonitorIndex
            : 0;

        if (monitorIndex < 0 || monitorIndex >= workspace._monitors.length)
            monitorIndex = 0;

        let monitor = workspace._monitors[monitorIndex];
        let isEmpty = monitor && typeof monitor.isEmpty === 'function'
            ? monitor.isEmpty()
            : !(monitor && monitor._windows && monitor._windows.length > 0);

        if (isEmpty && typeof workspace.findNextNonEmptyMonitor === 'function') {
            try {
                let candidate = workspace.findNextNonEmptyMonitor(
                    monitorIndex - 1,
                    1
                );
                if (candidate >= 0 && candidate < workspace._monitors.length) {
                    monitorIndex = candidate;
                    monitor = workspace._monitors[monitorIndex];
                }
            } catch (e) {}
        }

        return { monitor: monitor, index: monitorIndex };
    },

    // WorkspacesView already contains Cinnamon's window-selection model in
    // recent releases. Older releases expose the same Workspace/Monitor
    // primitives but do not reliably hand them keyboard focus, so this method
    // explicitly prepares focus and the visible selection in both layouts.
    _focusWorkspacesView: function(boundary) {
        let actor = this._getWorkspacesActor();
        if (!actor)
            return false;

        try {
            if (typeof actor.set_can_focus === 'function')
                actor.set_can_focus(true);
            else
                actor.can_focus = true;
        } catch (e) {}

        try {
            actor.grab_key_focus();
        } catch (e) {
            global.stage.set_key_focus(actor);
        }

        // Some older St actors silently ignore grab_key_focus() unless the
        // stage focus is assigned explicitly.
        if (global.stage.get_key_focus() !== actor) {
            try {
                global.stage.set_key_focus(actor);
            } catch (e) {}
        }

        let workspace = this._getActiveWorkspaceModel();
        let active = this._getActiveWorkspaceMonitor(workspace);
        if (!workspace || !active || !active.monitor)
            return true;

        let monitor = active.monitor;
        if (typeof workspace.selectMonitor === 'function') {
            try {
                workspace.selectMonitor(active.index);
            } catch (e) {}
        } else if (typeof monitor.showActiveSelection === 'function') {
            try {
                monitor.showActiveSelection();
            } catch (e) {}
        }

        let windowCount = monitor._windows ? monitor._windows.length : 0;
        if (windowCount > 0 && typeof monitor.selectIndex === 'function') {
            if (boundary === 'first')
                monitor.selectIndex(0);
            else if (boundary === 'last')
                monitor.selectIndex(windowCount - 1);
            else if (typeof monitor.showActiveSelection === 'function')
                monitor.showActiveSelection();
            else {
                let current = typeof monitor._kbWindowIndex === 'number'
                    ? monitor._kbWindowIndex
                    : 0;
                monitor.selectIndex(Math.max(0, Math.min(current, windowCount - 1)));
            }
        }

        return true;
    },

    _isWorkspaceNavigationKey: function(symbol) {
        return symbol === Clutter.KEY_Left ||
               symbol === Clutter.KEY_KP_Left ||
               symbol === Clutter.KEY_Right ||
               symbol === Clutter.KEY_KP_Right ||
               symbol === Clutter.KEY_Up ||
               symbol === Clutter.KEY_KP_Up ||
               symbol === Clutter.KEY_Down ||
               symbol === Clutter.KEY_KP_Down ||
               symbol === Clutter.KEY_Return ||
               symbol === Clutter.KEY_KP_Enter ||
               symbol === Clutter.KEY_space ||
               symbol === Clutter.KEY_Home ||
               symbol === Clutter.KEY_KP_Home ||
               symbol === Clutter.KEY_End ||
               symbol === Clutter.KEY_KP_End ||
               symbol === Clutter.KEY_Tab ||
               symbol === Clutter.KEY_ISO_Left_Tab;
    },

    _dispatchWorkspaceKey: function(event) {
        if (this._viewMode !== ViewMode.WORKSPACES)
            return false;

        let workspace = this._getActiveWorkspaceModel();
        let actor = this._getWorkspacesActor();
        if (!workspace || !actor)
            return false;

        this._focusWorkspacesView();

        // Preferred path: use Cinnamon's own implementation. It provides the
        // exact visual selection, grid movement, monitor traversal and window
        // activation semantics used by the stock overview.
        if (typeof workspace._onKeyPress === 'function') {
            try {
                let handled = workspace._onKeyPress(actor, event);
                return handled === true || handled === Clutter.EVENT_STOP;
            } catch (e) {
                global.logWarning('Overview workspace key handler failed: ' + e);
            }
        }

        // Compatibility fallback for older prototype-based WorkspacesView.
        let symbol = event.get_key_symbol
            ? event.get_key_symbol()
            : event.keyval;
        let active = this._getActiveWorkspaceMonitor(workspace);
        if (!active || !active.monitor)
            return false;

        let monitor = active.monitor;
        if (symbol === Clutter.KEY_Return ||
            symbol === Clutter.KEY_KP_Enter ||
            symbol === Clutter.KEY_space) {
            if (typeof monitor.activateSelectedWindow === 'function') {
                try {
                    if (monitor.activateSelectedWindow())
                        return true;
                } catch (e) {}
            }
            return false;
        }

        if (symbol === Clutter.KEY_Home || symbol === Clutter.KEY_KP_Home ||
            symbol === Clutter.KEY_End || symbol === Clutter.KEY_KP_End) {
            if (monitor._windows && monitor._windows.length > 0 &&
                typeof monitor.selectIndex === 'function') {
                monitor.selectIndex(
                    symbol === Clutter.KEY_Home || symbol === Clutter.KEY_KP_Home
                        ? 0
                        : monitor._windows.length - 1
                );
                return true;
            }
        }

        if (typeof monitor.selectAnotherWindow === 'function') {
            try {
                return monitor.selectAnotherWindow(symbol) !== false;
            } catch (e) {}
        }

        if (typeof workspace.selectAnotherWindow === 'function') {
            try {
                workspace.selectAnotherWindow(symbol);
                return true;
            } catch (e) {}
        }

        return false;
    },

    _focusCurrentView: function() {
        if (this._viewMode === ViewMode.WORKSPACES)
            return this._focusWorkspacesView();

        return this._focusSearchEntry();
    },

    _deleteLastSearchCharacter: function() {
        if (!this.searchEntry)
            return;

        let text = this.searchEntry.get_text();
        if (!text)
            return;

        let characters = Array.from(text);
        characters.pop();
        this.searchEntry.set_text(characters.join(''));
        try {
            this.searchEntry.clutter_text.set_cursor_position(-1);
        } catch (e) {}
    },

    _onSearchEntryKeyPress: function(actor, event) {
        let symbol = event.get_key_symbol();
        let moveDown = symbol === Clutter.KEY_Down ||
                       symbol === Clutter.KEY_KP_Down;
        let moveUp = symbol === Clutter.KEY_Up ||
                     symbol === Clutter.KEY_KP_Up;

        if (this._viewMode === ViewMode.SEARCH &&
            this.searchResultsPanel && (moveDown || moveUp)) {
            return moveDown
                ? this.searchResultsPanel.focusFirst()
                : this.searchResultsPanel.focusLast();
        }

        if (this._viewMode === ViewMode.APPS && this.appGrid &&
            (moveDown || moveUp)) {
            return moveDown
                ? this.appGrid.focusFirst()
                : this.appGrid.focusLast();
        }

        if (this._viewMode === ViewMode.WORKSPACES &&
            this.workspacesView) {
            if (moveDown || moveUp)
                return this._focusWorkspacesView(moveUp ? 'last' : 'first');

            if (this._isWorkspaceNavigationKey(symbol)) {
                this._focusWorkspacesView();
                return this._dispatchWorkspaceKey(event);
            }
        }

        return false;
    },

    // ──────────────────────────────────────────────────────────────────────────
    // Stage-level key handler: forward printable keys to the search entry
    // and handle Escape.
    // ──────────────────────────────────────────────────────────────────────────
    _onStageKeyPress: function(actor, event) {
        if (!this.visible || !this._shown || this._hideInProgress)
            return false;

        let symbol = event.get_key_symbol();

        if (symbol === Clutter.KEY_Escape) {
            this.hide();
            return true;
        }

        let focusedActor = global.stage.get_key_focus();
        let workspacesActor = this._getWorkspacesActor();

        // WorkspacesView has differed across Cinnamon releases: some versions
        // receive these events natively, while older actor wrappers do not.
        // If an event reaches the stage unhandled, route it through the same
        // workspace model explicitly.
        if (this._viewMode === ViewMode.WORKSPACES &&
            this._isWorkspaceNavigationKey(symbol) &&
            (!this.searchEntry || focusedActor !== this.searchEntry.clutter_text) &&
            (focusedActor === workspacesActor ||
             focusedActor === this._group ||
             focusedActor === null)) {
            return this._dispatchWorkspaceKey(event);
        }

        // Let the entry handle editing, composition and its own navigation.
        if (this.searchEntry &&
            focusedActor === this.searchEntry.clutter_text)
            return false;

        // Backspace from a focused application/result returns to the entry and
        // edits the query, keeping the workflow fully keyboard-accessible.
        if (symbol === Clutter.KEY_BackSpace && this.searchEntry) {
            this._focusSearchEntry();
            this._deleteLastSearchCharacter();
            return true;
        }

        // get_key_unicode() returns a numeric gunichar, not a JavaScript string.
        let codepoint = event.get_key_unicode();
        let modifiers = Cinnamon.get_event_state(event);
        let shortcutModifiers = Clutter.ModifierType.CONTROL_MASK |
                                Clutter.ModifierType.MOD1_MASK;

        if (this.searchEntry && codepoint !== 0 &&
            !(modifiers & shortcutModifiers)) {
            global.stage.set_key_focus(this.searchEntry.clutter_text);
            this.searchEntry.clutter_text.insert_unichar(codepoint);
            return true;
        }

        return false;
    },

    //// Public methods ////

    show: function() {
        this.showWorkspaces();
    },

    showWorkspaces: function() {
        this._showView(ViewMode.WORKSPACES);
    },

    _showView: function(mode) {
        this._requestedViewMode = mode;

        let wasShown = this._shown;
        if (!wasShown) {
            let hadModal = this._modal;
            if (!hadModal && !Main.pushModal(this._group))
                return;

            this._modal = true;
            this._shown = true;

            if (this._buttonPressId === 0) {
                this._buttonPressId = this._group.connect('button-press-event',
                    Lang.bind(this, this._onButtonPress));
            }
        }

        // A second Super or another show request during a provisional/normal
        // close reverses the same opacity transition in place. Check this
        // before the ordinary already-shown branch; otherwise showAppGrid()
        // would change only the child view while the parent kept fading out.
        if (this.visible && this._hideInProgress) {
            this._reverseHideToVisible(mode);
            return;
        }

        if (wasShown) {
            // A second Super during the opening animation changes only the
            // destination. It must never start another visibility animation.
            this._setBaseView(mode, true);
            return;
        }

        if (this.visible) {
            this._setBaseView(mode, true);
            return;
        }

        this._animateVisible();
    },

    getSuperKeyState: function() {
        if (!this._shown)
            return 'closed';

        if (this._viewMode === ViewMode.APPS ||
            (this.animationInProgress &&
             this._requestedViewMode === ViewMode.APPS))
            return 'app-grid';

        // Search is treated as part of the workspaces overview for Super.
        return 'workspaces';
    },

    _startVisibilityTransition: function(targetOpacity, baseDuration,
                                         mode, hiding, onComplete) {
        this._animationGeneration++;
        let generation = this._animationGeneration;

        try {
            this._group.remove_all_transitions();
        } catch (e) {}

        let currentOpacity = Number(this._group.opacity);
        if (!isFinite(currentOpacity))
            currentOpacity = targetOpacity === 0 ? 255 : 0;

        let remaining = Math.abs(targetOpacity - currentOpacity) / 255;
        let duration = Math.max(
            MIN_REVERSAL_TIME,
            Math.round(baseDuration * Math.max(0.22, remaining))
        );

        this.animationInProgress = true;
        this._hideInProgress = !!hiding;

        this._group.ease({
            opacity: targetOpacity,
            duration: duration,
            mode: mode,
            onComplete: () => {
                if (generation !== this._animationGeneration)
                    return;
                onComplete(generation);
            }
        });
    },

    _reverseHideToVisible: function(mode) {
        this._requestedViewMode = mode;
        Main.panelManager.enterOverviewMode();

        if (this._coverPane) {
            this._coverPane.raise_top();
            this._coverPane.show();
        }

        this._setBaseView(mode, false);
        this.emit('showing');

        this._startVisibilityTransition(
            255,
            OVERVIEW_SHOW_TIME,
            Clutter.AnimationMode.EASE_OUT_CUBIC,
            false,
            (generation) => this._showDone(generation)
        );
    },

    _animateForegroundEntrance: function() {
        let actors = [this.searchEntry, this._viewSwitcher];
        let activeActor = this._getViewActor(this._viewMode);
        if (activeActor)
            actors.push(activeActor);

        for (let i = 0; i < actors.length; i++) {
            let actor = actors[i];
            if (!actor)
                continue;

            try {
                actor.remove_all_transitions();
                actor.translation_y = 10;
                actor.opacity = 0;
                actor.ease({
                    translation_y: 0,
                    opacity: 255,
                    duration: OVERVIEW_SHOW_TIME + 35,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC
                });
            } catch (e) {
                actor.translation_y = 0;
                actor.opacity = 255;
            }
        }
    },

    _getOverviewMonitorGeometry: function(monitorIndex) {
        if (Main.panelManager &&
            typeof Main.panelManager.getOverviewMonitorGeometry === 'function')
            return Main.panelManager.getOverviewMonitorGeometry(monitorIndex);

        let monitor = Main.layoutManager.monitors[monitorIndex] ||
                      Main.layoutManager.primaryMonitor;
        return {
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height
        };
    },

    _animateVisible: function() {
        if (this.visible || this.animationInProgress)
            return;

        // Normal closes release the desktop before tearing down the expensive
        // workspace/app actors. A rapid reopen flushes that deferred cleanup
        // once, before creating the new scene, so actors can never duplicate.
        this._flushDeferredTeardown();

        let primary = this._getOverviewMonitorGeometry(
            Main.layoutManager.primaryIndex
        );

        // ── Background layer ──────────────────────────────────────────────────
        // Reproduce the desktop wallpaper behind a translucent dark shade.
        this._background = new Clutter.Actor();
        this._background.set_position(0, 0);
        this._background.set_size(global.screen_width, global.screen_height);
        this._group.add_actor(this._background);

        let desktopBackground;
        if (!Meta.is_wayland_compositor()) {
            desktopBackground = Meta.X11BackgroundActor.new_for_display(global.display);
        } else {
            desktopBackground = new Clutter.Actor();
        }
        this._background.add_actor(desktopBackground);

        // A translucent vertical gradient keeps the wallpaper visible while
        // giving the overview a GNOME/Zorin/ChromeOS-like depth. It is cheaper
        // and more portable than relying on compositor-specific blur effects.
        let backgroundShade = new St.Widget({
            reactive: false,
            style: 'background-color: rgba(5,7,14,0.84);' +
                   'background-gradient-direction: vertical;' +
                   'background-gradient-start: rgba(27,31,48,0.72);' +
                   'background-gradient-end: rgba(3,5,10,0.95);'
        });
        backgroundShade.set_size(global.screen_width, global.screen_height);
        this._background.add_actor(backgroundShade);

        this.visible = true;
        this.animationInProgress = true;

        this._coverPane = new Clutter.Rectangle({ opacity: 0, reactive: true });
        this._group.add_actor(this._coverPane);
        this._coverPane.set_position(0, 0);
        this._coverPane.set_size(global.screen_width, global.screen_height);
        this._coverPane.connect('event', () => true);
        this._coverPane.hide();

        Meta.disable_unredirect_for_display(global.display);
        this._group.show();

        // ── Workspace windows view ────────────────────────────────────────────
        // The WorkspaceMonitor uses absolute screen coords, so we must pass the
        // correct geometry with top padding reserved for the search bar.
        // We add the actor directly to _group (NOT inside a BinLayout container)
        // so that the absolute positioning used internally is not clipped.
        this.workspacesView = new WorkspacesView.WorkspacesView();

        // Leave room for both the search field and the view switcher.
        let wsTopPad = OVERVIEW_HEADER_HEIGHT + 8;
        let wsHeight = primary.height - wsTopPad - 16;
        // WorkspacesView._init already called setGeometry(primary.x, primary.y, primary.width, primary.height, 0)
        // Override it now that we know the correct area:
        this.workspacesView.setGeometry(primary.x, primary.y + wsTopPad,
                                        primary.width, wsHeight, 0);
        // Also update each workspace's monitors
        if (this.workspacesView._workspaces) {
            for (let i = 0; i < this.workspacesView._workspaces.length; i++) {
                let ws = this.workspacesView._workspaces[i];
                if (ws._monitors) {
                    for (let j = 0; j < ws._monitors.length; j++) {
                        let mon = this._getOverviewMonitorGeometry(j);
                        let mTop = (j === Main.layoutManager.primaryIndex)
                                   ? wsTopPad : 0;
                        ws._monitors[j].setGeometry(
                            mon.x, mon.y + mTop,
                            mon.width, Math.max(1, mon.height - mTop - 16),
                            mon.width * 0.04);
                    }
                }
            }
        }

        this._group.add_actor(this.workspacesView.actor);

        // ── App grid ─────────────────────────────────────────────────────────
        this.appGrid = new AppGrid.AppGrid(
            () => this._focusSearchEntry()
        );
        this.appGrid.actor.hide();
        // Position the application grid below the modern header.
        this.appGrid.actor.set_position(
            primary.x,
            primary.y + OVERVIEW_HEADER_HEIGHT
        );
        this.appGrid.actor.set_size(
            primary.width,
            primary.height - OVERVIEW_HEADER_HEIGHT
        );
        // Tell the grid how wide it is so it can compute correct column count
        this.appGrid.setAvailWidth(primary.width);
        this._group.add_actor(this.appGrid.actor);

        // ── Search results panel — centered floating card ──────────────────────
        // A narrower card reads more like a launcher and less like a full-screen
        // settings panel. It still shrinks safely on small displays.
        let srW = Math.max(1,
            Math.min(SEARCH_RESULTS_MAX_WIDTH, primary.width - 32));
        let srX = primary.x + Math.floor((primary.width - srW) / 2);
        let srY = primary.y + OVERVIEW_HEADER_HEIGHT + 8;
        let availableResultsHeight = primary.height -
                                     OVERVIEW_HEADER_HEIGHT - 24;
        let srH = Math.max(1,
            Math.min(720, availableResultsHeight));

        this.searchResultsPanel = new SearchResults.SearchResults(
            this.appGrid.getApps(),
            () => this._focusSearchEntry(),
            (app, sourceActor) => {
                if (this.appGrid)
                    this.appGrid.openAppContextMenu(app, sourceActor);
            }
        );
        if (this.searchResultsPanel.setAvailableWidth)
            this.searchResultsPanel.setAvailableWidth(srW);
        this.searchResultsPanel.actor.set_position(srX, srY);
        this.searchResultsPanel.actor.set_size(srW, srH);
        this.searchResultsPanel.actor.hide();
        this._group.add_actor(this.searchResultsPanel.actor);

        // ── Search bar ────────────────────────────────────────────────────────
        let searchNormalStyle =
            'border-radius: 26px; padding: 0 22px; font-size: 16px;' +
            'background-color: rgba(20,23,34,0.88);' +
            'color: rgba(247,248,252,0.98);' +
            'border: 1px solid rgba(255,255,255,0.13);' +
            'box-shadow: 0 12px 34px rgba(0,0,0,0.38);';
        let searchFocusStyle =
            'border-radius: 26px; padding: 0 22px; font-size: 16px;' +
            'background-color: rgba(24,28,41,0.96);' +
            'color: rgba(255,255,255,1.0);' +
            'border: 1px solid rgba(120,174,237,0.62);' +
            'box-shadow: 0 14px 38px rgba(0,0,0,0.46);';

        this.searchEntry = new St.Entry({
            style_class: 'overview-search-entry',
            hint_text: 'Pesquisar aplicativos, arquivos ou digitar URL…',
            track_hover: true,
            can_focus: true,
            style: searchNormalStyle
        });

        try {
            this.searchEntry.clutter_text.set_max_length(
                MAX_SEARCH_ACTIVATION_LENGTH
            );
        } catch (e) {
            // Older Clutter.Text introspection versions may expose only the
            // property; query sanitization still enforces the same limit.
            try {
                this.searchEntry.clutter_text.max_length =
                    MAX_SEARCH_ACTIVATION_LENGTH;
            } catch (propertyError) {}
        }

        // Cinnamon exposes primary/secondary actors on St.Entry. The try/catch
        // keeps compatibility with older St introspection builds.
        try {
            this.searchEntry.set_primary_icon(new St.Icon({
                icon_name: 'edit-find-symbolic',
                icon_size: 19,
                style: 'color: rgba(220,226,238,0.72);'
            }));
        } catch (e) {}

        let entryWidth = Math.max(1,
            Math.min(SEARCH_BAR_ENTRY_WIDTH, primary.width - 32));
        let entryX = primary.x + (primary.width - entryWidth) / 2;
        let entryY = primary.y + SEARCH_BAR_ENTRY_TOP;
        this.searchEntry.set_position(entryX, entryY);
        this.searchEntry.set_size(entryWidth, SEARCH_BAR_ENTRY_HEIGHT);

        this.searchEntry.clutter_text.connect('key-focus-in', () => {
            if (this.searchEntry)
                this.searchEntry.set_style(searchFocusStyle);
        });
        this.searchEntry.clutter_text.connect('key-focus-out', () => {
            if (this.searchEntry)
                this.searchEntry.set_style(searchNormalStyle);
        });

        // Thin blinking cursor
        try {
            this.searchEntry.clutter_text.cursor_color = new Clutter.Color({
                red: 255, green: 255, blue: 255, alpha: 230
            });
            this.searchEntry.clutter_text.cursor_size = 1;
        } catch(e) {}

        this.searchEntry.clutter_text.connect('key-press-event',
            Lang.bind(this, this._onSearchEntryKeyPress));
        this.searchEntry.clutter_text.connect('text-changed',
            Lang.bind(this, this._onSearchTextChanged));
        this.searchEntry.clutter_text.connect('activate',
            Lang.bind(this, this._onSearchActivated));

        this._group.add_actor(this.searchEntry);
        this._createViewSwitcher(primary);

        // ── Stage key handlers ─────────────────────────────────────────────────
        this._stageKeyPressId = global.stage.connect('key-press-event',
            Lang.bind(this, this._onStageKeyPress));
        this._stageTabCaptureId = global.stage.connect('captured-event',
            Lang.bind(this, this._onStageCapturedKeyEvent));

        // Workspaces owns focus in the window view so Cinnamon's native
        // thumbnail navigation receives arrows and Enter. Apps/Search keep the
        // search field focused; printable keys from Workspaces are forwarded
        // there by _onStageKeyPress().
        this._focusIdleId = Mainloop.idle_add(() => {
            this._focusIdleId = 0;
            if (this._shown)
                this._focusCurrentView();
            return false;
        });

        Main.panelManager.enterOverviewMode();

        this._coverPane.raise_top();
        this._coverPane.show();
        this.emit('showing');

        this._setBaseView(this._requestedViewMode, false);

        this._group.opacity = 0;
        this._animateForegroundEntrance();
        this._startVisibilityTransition(
            255,
            OVERVIEW_SHOW_TIME,
            Clutter.AnimationMode.EASE_OUT_CUBIC,
            false,
            (generation) => this._showDone(generation)
        );
    },

    showTemporarily: function() {
        if (this._shownTemporarily)
            return;

        this._syncInputMode();
        this._animateVisible();
        this._shownTemporarily = true;
    },

    hide: function() {
        this._clearShortcutSequence();

        if (!this._shown)
            return;

        // Destroying a WindowClone while its own DND modal grab is active
        // can leave currentDraggable waiting for a release on a finalized actor.
        // Do not block closing for unrelated or recently completed global DND
        // operations; that broad guard could swallow the first Super tap.
        if (this.workspacesView &&
            typeof this.workspacesView.isWindowDragInProgress === 'function' &&
            this.workspacesView.isWindowDragInProgress())
            return;

        this._shown = false;
        this._requestedViewMode = ViewMode.WORKSPACES;

        if (!this._shownTemporarily)
            this._animateNotVisible();

        this._syncInputMode();

        if (this._buttonPressId > 0)
            this._group.disconnect(this._buttonPressId);
        this._buttonPressId = 0;
    },

    hideTemporarily: function() {
        if (!this._shownTemporarily)
            return;

        if (!this._shown)
            this._animateNotVisible();

        this._shownTemporarily = false;
        this._syncInputMode();
    },

    _createViewSwitcher: function(primary) {
        let width = Math.max(190,
            Math.min(VIEW_SWITCHER_WIDTH, primary.width - 32));
        let x = primary.x + Math.floor((primary.width - width) / 2);
        let y = primary.y + VIEW_SWITCHER_TOP;

        this._viewSwitcher = new St.BoxLayout({
            x_expand: false,
            y_expand: false,
            style: 'padding: 3px; spacing: 3px; border-radius: 20px;' +
                   'background-color: rgba(13,15,23,0.70);' +
                   'border: 1px solid rgba(255,255,255,0.10);' +
                   'box-shadow: 0 8px 24px rgba(0,0,0,0.30);'
        });
        this._viewSwitcher.set_position(x, y);
        this._viewSwitcher.set_size(width, VIEW_SWITCHER_HEIGHT);

        this._workspaceViewButton = new St.Button({
            label: 'Janelas',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true
        });
        this._appsViewButton = new St.Button({
            label: 'Aplicativos',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true
        });

        let buttonWidth = Math.floor((width - 9) / 2);
        this._workspaceViewButton.set_width(buttonWidth);
        this._appsViewButton.set_width(buttonWidth);

        this._workspaceViewButton.connect('clicked', () => {
            this.showWorkspaces();
        });
        this._appsViewButton.connect('clicked', () => {
            this.showAppGrid();
        });

        let refreshHover = (button, mode, hovering) => {
            let activeMode = this._viewMode === ViewMode.SEARCH
                ? this._viewBeforeSearch
                : this._viewMode;
            if (activeMode !== mode && hovering)
                button.set_style(this._viewSwitcherButtonStyle(false, true));
            else
                this._updateViewSwitcher();
        };

        this._workspaceViewButton.connect('enter-event', () => {
            refreshHover(this._workspaceViewButton, ViewMode.WORKSPACES, true);
        });
        this._workspaceViewButton.connect('leave-event', () => {
            refreshHover(this._workspaceViewButton, ViewMode.WORKSPACES, false);
        });
        this._appsViewButton.connect('enter-event', () => {
            refreshHover(this._appsViewButton, ViewMode.APPS, true);
        });
        this._appsViewButton.connect('leave-event', () => {
            refreshHover(this._appsViewButton, ViewMode.APPS, false);
        });

        this._viewSwitcher.add_actor(this._workspaceViewButton);
        this._viewSwitcher.add_actor(this._appsViewButton);
        this._group.add_actor(this._viewSwitcher);
        this._updateViewSwitcher();
    },

    _viewSwitcherButtonStyle: function(active, hovering) {
        let base = 'border-radius: 16px; padding: 7px 16px;' +
                   'font-size: 12px; font-weight: bold;';

        if (active) {
            return base +
                'background-color: rgba(255,255,255,0.16);' +
                'color: rgba(255,255,255,0.98);' +
                'border: 1px solid rgba(255,255,255,0.10);' +
                'box-shadow: 0 4px 12px rgba(0,0,0,0.22);';
        }

        if (hovering) {
            return base +
                'background-color: rgba(255,255,255,0.08);' +
                'color: rgba(245,247,252,0.94);' +
                'border: 1px solid transparent;';
        }

        return base +
            'background-color: transparent;' +
            'color: rgba(204,208,220,0.68);' +
            'border: 1px solid transparent;';
    },

    _updateViewSwitcher: function() {
        if (!this._workspaceViewButton || !this._appsViewButton)
            return;

        let activeMode = this._viewMode === ViewMode.SEARCH
            ? this._viewBeforeSearch
            : this._viewMode;

        this._workspaceViewButton.set_style(
            this._viewSwitcherButtonStyle(
                activeMode === ViewMode.WORKSPACES,
                false
            )
        );
        this._appsViewButton.set_style(
            this._viewSwitcherButtonStyle(
                activeMode === ViewMode.APPS,
                false
            )
        );
    },

    _getViewActor: function(mode) {
        if (mode === ViewMode.WORKSPACES)
            return this.workspacesView ? this.workspacesView.actor : null;
        if (mode === ViewMode.APPS)
            return this.appGrid ? this.appGrid.actor : null;
        if (mode === ViewMode.SEARCH)
            return this.searchResultsPanel
                ? this.searchResultsPanel.actor
                : null;
        return null;
    },

    _prepareViewMode: function(mode) {
        if (mode === ViewMode.APPS && this.appGrid) {
            this.appGrid.prepare();
            this.appGrid.actor.queue_relayout();
        }
    },

    _resetViewActor: function(actor, visible) {
        if (!actor)
            return;

        try {
            actor.remove_all_transitions();
        } catch (e) {}
        actor.translation_y = 0;
        actor.opacity = 255;
        if (visible)
            actor.show();
        else
            actor.hide();
    },

    _applyViewMode: function(mode, animate) {
        let previousMode = this._viewMode;
        let outgoing = this._getViewActor(previousMode);

        this._prepareViewMode(mode);
        this._viewMode = mode;
        this.isSearchVisible = mode === ViewMode.SEARCH;
        this.isAppGridVisible = mode === ViewMode.APPS;

        if (previousMode === ViewMode.APPS && mode !== ViewMode.APPS &&
            this.appGrid)
            this.appGrid.closeContextMenu(false);

        let incoming = this._getViewActor(mode);
        let actors = [
            this._getViewActor(ViewMode.WORKSPACES),
            this._getViewActor(ViewMode.APPS),
            this._getViewActor(ViewMode.SEARCH)
        ];

        this._viewAnimationGeneration++;
        let generation = this._viewAnimationGeneration;
        let canAnimate = animate !== false &&
                         previousMode !== mode &&
                         incoming && outgoing &&
                         this.visible && !this._hideInProgress &&
                         Number(this._group.opacity) > 16;

        for (let i = 0; i < actors.length; i++) {
            let actor = actors[i];
            if (!actor || actor === incoming || actor === outgoing)
                continue;
            this._resetViewActor(actor, false);
        }

        if (!canAnimate) {
            if (outgoing && outgoing !== incoming)
                this._resetViewActor(outgoing, false);
            this._resetViewActor(incoming, true);
            this._updateViewSwitcher();
            return;
        }

        let incomingWasVisible = !!incoming.visible;
        let incomingOpacity = incomingWasVisible
            ? Number(incoming.opacity)
            : 0;
        let incomingOffset = incomingWasVisible
            ? Number(incoming.translation_y || 0)
            : 9;

        try { incoming.remove_all_transitions(); } catch (e) {}
        try { outgoing.remove_all_transitions(); } catch (e) {}

        incoming.show();
        incoming.opacity = isFinite(incomingOpacity)
            ? Math.max(0, Math.min(255, incomingOpacity))
            : 0;
        incoming.translation_y = isFinite(incomingOffset)
            ? incomingOffset
            : 9;

        outgoing.show();
        outgoing.ease({
            opacity: 0,
            translation_y: -6,
            duration: VIEW_SWITCH_OUT_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (generation !== this._viewAnimationGeneration)
                    return;
                this._resetViewActor(outgoing, false);
            }
        });

        incoming.ease({
            opacity: 255,
            translation_y: 0,
            duration: VIEW_SWITCH_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC
        });

        this._updateViewSwitcher();
    },

    _clearSearch: function() {
        if (this.searchResultsPanel)
            this.searchResultsPanel.clear();

        if (this.searchEntry && this.searchEntry.get_text() !== '') {
            this._ignoreSearchChange = true;
            this.searchEntry.set_text('');
            this._ignoreSearchChange = false;
        }

        this.isSearchVisible = false;
    },

    _setBaseView: function(mode, animate) {
        if (mode !== ViewMode.APPS)
            mode = ViewMode.WORKSPACES;

        this._requestedViewMode = mode;
        this._viewBeforeSearch = mode;
        this._clearSearch();
        this._applyViewMode(mode, animate);

        if (this._shown)
            this._focusCurrentView();
    },

    _onSearchTextChanged: function() {
        if (this._ignoreSearchChange)
            return;

        let text = this.searchEntry.get_text();

        if (text.length > 0) {
            if (this._viewMode !== ViewMode.SEARCH) {
                this._viewBeforeSearch = this._viewMode === ViewMode.APPS
                    ? ViewMode.APPS
                    : ViewMode.WORKSPACES;
                this._applyViewMode(ViewMode.SEARCH, true);
            }

            if (this.searchResultsPanel)
                this.searchResultsPanel.search(text);
            return;
        }

        if (this._viewMode === ViewMode.SEARCH) {
            if (this.searchResultsPanel)
                this.searchResultsPanel.clear();
            this._applyViewMode(this._viewBeforeSearch, true);
            this._focusCurrentView();
        }
    },

    _onSearchActivated: function() {
        let text = _sanitizeSearchText(this.searchEntry.get_text());
        if (!text) return;

        let uri;

        // 1) Already has a protocol → use as-is
        if (/^https?:\/\//i.test(text)) {
            uri = text;
        // 2) Looks like a domain (no spaces, has a TLD like .com .org .br …)
        } else if (text.indexOf(' ') === -1 &&
                   /^[a-zA-Z0-9][a-zA-Z0-9\-]*(\.[a-zA-Z]{2,})+([\/?#][\S]*)?$/.test(text)) {
            uri = 'https://' + text;
        // 3) Everything else → web search with Google in the default browser
        } else {
            uri = 'https://www.google.com/search?q=' + encodeURIComponent(text);
        }

        try {
            Gio.app_info_launch_default_for_uri(uri, global.create_app_launch_context());
        } catch (e) {
            imports.misc.util.spawn(['xdg-open', uri]);
        }

        this.hide();
    },

    _clearShortcutSequence: function() {
        if (this._shortcutTimeoutId) {
            Mainloop.source_remove(this._shortcutTimeoutId);
            this._shortcutTimeoutId = 0;
        }

        this._shortcutGeneration++;
        this._shortcutPending = false;
        this._shortcutLastActivationMs = 0;
    },

    _armShortcutSequence: function(startState) {
        let generation = ++this._shortcutGeneration;
        this._shortcutPending = true;

        // In the window view, the old implementation waited for the whole
        // double-tap window and only then started a short fade. That produced a
        // visible pause followed by what looked like an instant disappearance.
        // Use the double-tap interval itself as a reversible close animation:
        // a single Super continuously fades to the desktop, while a second
        // Super reverses from the exact current opacity and opens Apps.
        if (startState === 'workspaces' &&
            this._beginShortcutClosePreview(generation))
            return;

        this._shortcutTimeoutId = Mainloop.timeout_add(
            SHORTCUT_DOUBLE_TAP_MS,
            () => {
                if (generation !== this._shortcutGeneration)
                    return false;

                this._shortcutTimeoutId = 0;
                this._shortcutPending = false;
                this._shortcutLastActivationMs = 0;
                return false;
            }
        );
    },

    _beginShortcutClosePreview: function(shortcutGeneration) {
        if (!this.visible || !this._shown || this._hideInProgress ||
            this.getSuperKeyState() !== 'workspaces')
            return false;

        this._prepareHideTransition();
        this._startVisibilityTransition(
            0,
            SHORTCUT_CLOSE_TIME,
            Clutter.AnimationMode.EASE_OUT_QUAD,
            true,
            (animationGeneration) => {
                // Escape, app activation or another explicit hide may reuse the
                // in-flight preview. In that case finish the already completed
                // visual close instead of leaving an invisible modal actor.
                if (!this._shown) {
                    this._hideDone(animationGeneration);
                    return;
                }

                if (shortcutGeneration !== this._shortcutGeneration ||
                    !this._shortcutPending)
                    return;

                this._shortcutPending = false;
                this._shortcutLastActivationMs = 0;
                this._shortcutTimeoutId = 0;
                this._shown = false;
                this._requestedViewMode = ViewMode.WORKSPACES;

                if (this._buttonPressId > 0)
                    this._group.disconnect(this._buttonPressId);
                this._buttonPressId = 0;

                this._hideDone(animationGeneration);
            }
        );
        return true;
    },

    toggle: function() {
        let nowMs = GLib.get_monotonic_time() / 1000;
        let isDoubleTap = this._shortcutPending &&
            nowMs - this._shortcutLastActivationMs <= SHORTCUT_DOUBLE_TAP_MS;

        if (isDoubleTap) {
            this._clearShortcutSequence();

            // Double activation has one invariant from every starting state:
            // it opens or keeps the application grid. It never closes.
            this.showAppGrid();
            return;
        }

        this._clearShortcutSequence();
        let startState = this.getSuperKeyState();
        this._shortcutLastActivationMs = nowMs;

        if (startState === 'closed') {
            this.showWorkspaces();
        } else if (startState === 'app-grid') {
            // A single press in Apps returns immediately to window overview.
            this.showWorkspaces();
        }
        // In Workspaces, the first activation starts a reversible fade. Its
        // completion commits a single press; a second press reverses to Apps.

        this._armShortcutSequence(startState);
    },

    showAppGrid: function() {
        this._showView(ViewMode.APPS);
    },

    toggleAppGrid: function() {
        if (this._shown && this._viewMode === ViewMode.APPS)
            this.showWorkspaces();
        else
            this.showAppGrid();
    },

    //// Private methods ////

    _syncInputMode: function() {
        if (this.animationInProgress)
            return;

        if (this._shown) {
            if (!this._modal) {
                if (Main.pushModal(this._group))
                    this._modal = true;
                else
                    this.hide();
            }
        } else if (this._shownTemporarily) {
            if (this._modal) {
                Main.popModal(this._group);
                this._modal = false;
            }
            global.stage_input_mode = Cinnamon.StageInputMode.FULLSCREEN;
        } else {
            if (this._modal) {
                Main.popModal(this._group);
                this._modal = false;
            }
            else if (global.stage_input_mode == Cinnamon.StageInputMode.FULLSCREEN)
                global.stage_input_mode = Cinnamon.StageInputMode.NORMAL;
        }
    },

    _prepareHideTransition: function() {
        // A close may interrupt a pointer swipe or a child-view crossfade.
        // Settle those first so the compositor animates one parent opacity
        // rather than several conflicting transitions in the same frame.
        this.cancelWorkspaceSwipe();
        this._viewAnimationGeneration++;

        let activeViewActor = this._getViewActor(this._viewMode);
        let viewActors = [
            this.workspacesView ? this.workspacesView.actor : null,
            this.appGrid ? this.appGrid.actor : null,
            this.searchResultsPanel ? this.searchResultsPanel.actor : null
        ];
        for (let actor of viewActors) {
            if (!actor)
                continue;
            try {
                actor.remove_all_transitions();
            } catch (e) {}
            actor.translation_y = 0;
            actor.opacity = 255;
            if (actor === activeViewActor)
                actor.show();
            else
                actor.hide();
        }

        for (let actor of [this.searchEntry, this._viewSwitcher]) {
            if (!actor)
                continue;
            try {
                actor.remove_all_transitions();
            } catch (e) {}
            actor.translation_y = 0;
            actor.opacity = 255;
        }

        if (this.appGrid)
            this.appGrid.closeContextMenu(false);

        this._clearSearch();

        if (this._focusIdleId) {
            Mainloop.source_remove(this._focusIdleId);
            this._focusIdleId = 0;
        }

        if (this._coverPane) {
            this._coverPane.raise_top();
            this._coverPane.show();
        }
        this.emit('hiding');
    },

    _animateNotVisible: function() {
        if (!this.visible || this._hideInProgress)
            return;

        this._prepareHideTransition();

        // Non-Super close actions remain deliberately quick. The Super path
        // uses _beginShortcutClosePreview(), where the recognition interval and
        // the visible fade are the same continuous transition.
        this._startVisibilityTransition(
            0,
            OVERVIEW_HIDE_TIME,
            Clutter.AnimationMode.EASE_OUT_CUBIC,
            true,
            (generation) => this._hideDone(generation)
        );
    },

    _showDone: function(generation) {
        if (generation !== this._animationGeneration)
            return;

        this.animationInProgress = false;
        this._hideInProgress = false;
        if (this._coverPane)
            this._coverPane.hide();

        this.emit('shown');
        if (!this._shown && !this._shownTemporarily)
            this._animateNotVisible();
        else
            this._focusCurrentView();

        this._syncInputMode();
        global.sync_pointer();
    },

    _destroyOverviewActors: function() {
        if (this._coverPane) {
            try { this._group.remove_actor(this._coverPane); } catch (e) {}
            this._coverPane.destroy();
            this._coverPane = null;
        }

        if (this._background) {
            try { this._group.remove_actor(this._background); } catch (e) {}
            this._background.destroy();
            this._background = null;
        }

        if (this.workspacesView) {
            try { this._group.remove_actor(this.workspacesView.actor); } catch (e) {}
            this.workspacesView.destroy();
            this.workspacesView = null;
        }

        if (this.appGrid) {
            try { this._group.remove_actor(this.appGrid.actor); } catch (e) {}
            this.appGrid.destroy();
            this.appGrid = null;
        }

        if (this.searchResultsPanel) {
            try { this._group.remove_actor(this.searchResultsPanel.actor); } catch (e) {}
            this.searchResultsPanel.destroy();
            this.searchResultsPanel = null;
        }

        if (this.searchEntry) {
            this.searchEntry.destroy();
            this.searchEntry = null;
        }

        if (this._viewSwitcher) {
            this._viewSwitcher.destroy();
            this._viewSwitcher = null;
            this._workspaceViewButton = null;
            this._appsViewButton = null;
        }

        this.isAppGridVisible = false;
        this.isSearchVisible = false;
        this._viewMode = ViewMode.WORKSPACES;
        this._viewBeforeSearch = ViewMode.WORKSPACES;
        if (!this._shown)
            this._requestedViewMode = ViewMode.WORKSPACES;
    },

    _scheduleDeferredTeardown: function() {
        if (this._teardownIdleId)
            return;

        let generation = ++this._teardownGeneration;
        this._teardownIdleId = Mainloop.idle_add(() => {
            this._teardownIdleId = 0;
            if (generation !== this._teardownGeneration ||
                this.visible || this._shown || this._shownTemporarily)
                return false;

            this._destroyOverviewActors();
            return false;
        });
    },

    _flushDeferredTeardown: function() {
        if (this._teardownIdleId) {
            Mainloop.source_remove(this._teardownIdleId);
            this._teardownIdleId = 0;
        }
        this._teardownGeneration++;

        if (this._coverPane || this._background || this.workspacesView ||
            this.appGrid || this.searchResultsPanel || this.searchEntry ||
            this._viewSwitcher)
            this._destroyOverviewActors();
    },

    _hideDone: function(generation) {
        if (generation !== this._animationGeneration)
            return;

        this.cancelWorkspaceSwipe();
        this._viewAnimationGeneration++;

        if (this._stageKeyPressId > 0) {
            global.stage.disconnect(this._stageKeyPressId);
            this._stageKeyPressId = 0;
        }
        if (this._stageTabCaptureId > 0) {
            global.stage.disconnect(this._stageTabCaptureId);
            this._stageTabCaptureId = 0;
        }

        // Make the desktop interactive before destroying the heavy workspace,
        // grid and search trees. Their teardown is moved to the next idle turn,
        // eliminating the end-of-close hitch while preserving fresh actors on
        // the next open.
        this._group.hide();
        this.visible = false;
        this.animationInProgress = false;
        this._hideInProgress = false;

        Meta.enable_unredirect_for_display(global.display);

        this.emit('hidden');
        Main.panelManager.leaveOverviewMode();
        this._syncInputMode();
        Main.layoutManager._chrome.updateRegions();

        if (this._shown || this._shownTemporarily) {
            this._flushDeferredTeardown();
            this._animateVisible();
        } else {
            this._scheduleDeferredTeardown();
        }
    }
};
Signals.addSignalMethods(Overview.prototype);
