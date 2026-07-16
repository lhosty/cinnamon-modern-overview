// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;
const Signals = imports.signals;

const DND = imports.ui.dnd;
const Main = imports.ui.main;
const Workspace = imports.ui.workspace;

var WORKSPACE_SWITCH_TIME = 250;
const WINDOW_DRAG_EDGE_DELAY = 450;
const WINDOW_DRAG_EDGE_MIN_SIZE = 28;
const WINDOW_DRAG_EDGE_MAX_SIZE = 64;

var SwipeScrollDirection = {
    NONE: 0,
    HORIZONTAL: 1,
    VERTICAL: 2
};

var SwipeScrollResult = {
    CANCEL: 0,
    SWIPE: 1,
    CLICK: 2
};

function WorkspacesView(workspaces) {
    this._init(workspaces);
}

WorkspacesView.prototype = {
    _init: function(workspaces) {
        this.actor = new St.Widget({ style_class: 'workspaces-view' });

        // The actor itself isn't a drop target, so we don't want to pick on its area
        this.actor.set_size(0, 0);

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        // does not work:
        // this.actor.connect('scroll-event', Lang.bind(this, this._onScrollEvent));

        this.actor.connect('style-changed', Lang.bind(this,
            function() {
                let node = this.actor.get_theme_node();
                this._spacing = node.get_length('spacing');
                this._updateWorkspaceActors(false);
            }));
        this.actor.connect('notify::mapped', Lang.bind(this, this._onMappedChanged));

        this._width = 0;
        this._height = 0;
        this._x = 0;
        this._y = 0;
        this._workspaceRatioSpacing = 0;
        this._spacing = 0;
        this._animating = false; // tweening
        this._scrolling = false; // swipe-scrolling
        this._animatingScroll = false; // programmatically updating the adjustment
        this._swipeStartIndex = -1;
        this._pendingSwipeCommitIndex = -1;
        this._swipeSettleGeneration = 0;
        this._swipeSettleTimeoutId = 0;

        this._windowDragSource = null;
        this._windowDragMonitorActive = false;
        this._windowDragMonitor = {
            dragMotion: this._onWindowDragMotion.bind(this)
        };
        this._edgeSwitchTimeoutId = 0;
        this._edgeSwitchDirection = null;
        this._edgeSwitchMonitorIndex = -1;
        this._edgeSwitchLatched = false;

        this._keyIsHandled = true;

        let activeWorkspaceIndex = global.workspace_manager.get_active_workspace_index();
        this._workspaces = [];
        for (let i = 0; i < global.workspace_manager.n_workspaces; i++) {
            let metaWorkspace = global.workspace_manager.get_workspace_by_index(i);
            this._workspaces[i] = new Workspace.Workspace(metaWorkspace, this);
            this.actor.add_actor(this._workspaces[i].actor);
        }
        this._workspaces[activeWorkspaceIndex].actor.raise_top();

        // Position/scale the desktop windows and their children after the
        // workspaces have been created. This cannot be done first because
        // window movement depends on the Workspaces object being accessible
        // as an Overview member.
        let overviewShowingId = Main.overview.connect('showing', () => {
            Main.overview.disconnect(overviewShowingId);
            for(let workspace of this._workspaces)
                workspace.zoomToOverview();
        });

        this._scrollAdjustment = new St.Adjustment({ value: activeWorkspaceIndex,
                                                     lower: 0,
                                                     page_increment: 1,
                                                     page_size: 1,
                                                     step_increment: 0,
                                                     upper: this._workspaces.length });
        this._scrollAdjustment.connect('notify::value',
                                       Lang.bind(this, this._onScroll));


        this._swipeScrollBeginId = 0;
        this._swipeScrollEndId = 0;

        let restackedNotifyId = global.display.connect('restacked', Lang.bind(this, this._onRestacked));
        let switchWorkspaceNotifyId = global.window_manager.connect('switch-workspace',
                                          Lang.bind(this, this._activeWorkspaceChanged));

        let nWorkspacesChangedId = global.workspace_manager.connect('notify::n-workspaces', Lang.bind(this, this._workspacesChanged));

        this._disconnectHandlers = function() {
            global.window_manager.disconnect(switchWorkspaceNotifyId);
            global.workspace_manager.disconnect(nWorkspacesChangedId);
            global.display.disconnect(restackedNotifyId);
        };

        this._onRestacked();
        this.actor.connect('key-press-event', this._onStageKeyPress.bind(this));
        this.actor.connect('key-release-event', this._onStageKeyRelease.bind(this));
        global.stage.set_key_focus(this.actor);

        let primary = Main.layoutManager.primaryMonitor;
        this.setGeometry(primary.x, primary.y, primary.width, primary.height, 0);
    },

    _onStageKeyPress: function(actor, event) {
        let activeWorkspaceIndex = global.workspace_manager.get_active_workspace_index();
        let activeWorkspace = this._workspaces[activeWorkspaceIndex];
        this._keyIsHandled = activeWorkspace._onKeyPress(actor, event);
        return this._keyIsHandled;
    },

    _onStageKeyRelease: function(actor, event) {
        if (this._keyIsHandled)
            return false;

        let modifiers = Cinnamon.get_event_state(event);
        let symbol = event.get_key_symbol();

        switch (symbol) {
            case Clutter.KEY_Escape:
                Main.overview.hide();
                return true;
            default:
                return false;
        }
    },

    setGeometry: function(x, y, width, height, spacing) {
        this._width = width;
        this._height = height;
        this._x = x;
        this._y = y;
        this._workspaceRatioSpacing = spacing;
    },

    getActiveWorkspace: function() {
        let active = global.workspace_manager.get_active_workspace_index();
        return this._workspaces[active];
    },

    getWorkspaceByIndex: function(index) {
        return this._workspaces[index];
    },

    isWindowDragInProgress: function() {
        return !!this._windowDragSource && DND.isDragging();
    },

    beginWindowDrag: function(source) {
        if (!source || !source.metaWindow)
            return;

        if (Main.overview &&
            typeof Main.overview.cancelWorkspaceSwipe === 'function')
            Main.overview.cancelWorkspaceSwipe();

        this._windowDragSource = source;
        this._cancelEdgeSwitch();
        this._edgeSwitchLatched = false;

        if (!this._windowDragMonitorActive) {
            DND.addDragMonitor(this._windowDragMonitor);
            this._windowDragMonitorActive = true;
        }

        this._updateVisibility();
    },

    endWindowDrag: function(source, success) {
        if (source && this._windowDragSource &&
            source !== this._windowDragSource)
            return;

        this._removeWindowDragMonitor();
        this._windowDragSource = null;
        this._edgeSwitchLatched = false;

        if (!this.actor.is_finalized()) {
            let active = global.workspace_manager.get_active_workspace_index();
            this._animating = false;
            this._animatingScroll = false;
            this._cancelScrollAdjustmentTransitions();
            this._updateWorkspaceActors(false);
            this._updateScrollAdjustment(active, false);
            this._updateVisibility();
        }
    },

    _removeWindowDragMonitor: function() {
        this._cancelEdgeSwitch();
        if (!this._windowDragMonitorActive)
            return;

        DND.removeDragMonitor(this._windowDragMonitor);
        this._windowDragMonitorActive = false;
    },

    _cancelEdgeSwitch: function() {
        if (this._edgeSwitchTimeoutId) {
            Mainloop.source_remove(this._edgeSwitchTimeoutId);
            this._edgeSwitchTimeoutId = 0;
        }
        this._edgeSwitchDirection = null;
        this._edgeSwitchMonitorIndex = -1;
    },

    _edgeDirectionAt: function(x, monitor) {
        let edgeSize = Math.max(
            WINDOW_DRAG_EDGE_MIN_SIZE,
            Math.min(
                WINDOW_DRAG_EDGE_MAX_SIZE,
                Math.round(monitor.width * 0.025)
            )
        );

        if (x <= monitor.x + edgeSize)
            return Meta.MotionDirection.LEFT;
        if (x >= monitor.x + monitor.width - edgeSize)
            return Meta.MotionDirection.RIGHT;
        return null;
    },

    _onWindowDragMotion: function(dragEvent) {
        if (!this._windowDragSource ||
            dragEvent.source !== this._windowDragSource ||
            !DND.isDragging()) {
            this._cancelEdgeSwitch();
            return DND.DragMotionResult.CONTINUE;
        }

        let monitorIndex = Main.layoutManager.findMonitorIndexAt(
            dragEvent.x,
            dragEvent.y
        );
        if (monitorIndex < 0)
            monitorIndex = Main.layoutManager.primaryIndex;

        let monitor = Main.layoutManager.monitors[monitorIndex];
        if (!monitor) {
            this._cancelEdgeSwitch();
            return DND.DragMotionResult.CONTINUE;
        }

        let direction = this._edgeDirectionAt(dragEvent.x, monitor);
        if (direction === null) {
            this._cancelEdgeSwitch();
            this._edgeSwitchLatched = false;
            return DND.DragMotionResult.CONTINUE;
        }

        if (this._edgeSwitchLatched &&
            direction === this._edgeSwitchDirection)
            return DND.DragMotionResult.CONTINUE;

        let active = global.workspace_manager.get_active_workspace();
        let neighbor = active.get_neighbor(direction);
        if (!neighbor || neighbor === active) {
            this._cancelEdgeSwitch();
            return DND.DragMotionResult.CONTINUE;
        }

        if (this._edgeSwitchTimeoutId &&
            this._edgeSwitchDirection === direction &&
            this._edgeSwitchMonitorIndex === monitorIndex)
            return DND.DragMotionResult.CONTINUE;

        this._cancelEdgeSwitch();
        this._edgeSwitchDirection = direction;
        this._edgeSwitchMonitorIndex = monitorIndex;
        this._edgeSwitchTimeoutId = Mainloop.timeout_add(
            WINDOW_DRAG_EDGE_DELAY,
            () => {
                this._edgeSwitchTimeoutId = 0;

                if (!this._windowDragSource || !DND.isDragging())
                    return false;

                let [pointerX, pointerY] = global.get_pointer();
                let currentMonitor = Main.layoutManager.monitors[
                    this._edgeSwitchMonitorIndex
                ];
                if (!currentMonitor ||
                    this._edgeDirectionAt(pointerX, currentMonitor) !==
                        this._edgeSwitchDirection)
                    return false;

                let current = global.workspace_manager.get_active_workspace();
                let target = current.get_neighbor(this._edgeSwitchDirection);
                if (target && target !== current) {
                    target.activate(global.get_current_time());
                    this._edgeSwitchLatched = true;
                }

                return false;
            }
        );

        return DND.DragMotionResult.CONTINUE;
    },

    hide: function() {
        let activeWorkspaceIndex = global.workspace_manager.get_active_workspace_index();
        let activeWorkspace = this._workspaces[activeWorkspaceIndex];

        activeWorkspace.actor.raise_top();
        activeWorkspace.zoomFromOverview();
    },

    destroy: function() {
        this._removeWindowDragMonitor();
        this._windowDragSource = null;
        Main.overview.setScrollAdjustment(
            null,
            SwipeScrollDirection.NONE
        );

        if (this._swipeScrollBeginId > 0) {
            Main.overview.disconnect(this._swipeScrollBeginId);
            this._swipeScrollBeginId = 0;
        }
        if (this._swipeScrollEndId > 0) {
            Main.overview.disconnect(this._swipeScrollEndId);
            this._swipeScrollEndId = 0;
        }

        for (let w = 0; w < this._workspaces.length; w++) {
            this._workspaces[w].disconnectAll();
            this._workspaces[w].destroy();
        }
        this._workspaces = [];
        this.actor.destroy();
    },

    updateWindowPositions: function() {
        for (let w = 0; w < this._workspaces.length; w++)
            this._workspaces[w].positionWindows(Workspace.WindowPositionFlags.ANIMATE);
    },

    _scrollToActive: function(showAnimation) {
        let active = global.workspace_manager.get_active_workspace_index();

        this._updateWorkspaceActors(showAnimation);
        Main.wm.showWorkspaceOSD();
        this._updateScrollAdjustment(active, showAnimation);
    },

    // Update workspace actors parameters
    // @showAnimation: iff %true, transition between states
    _updateWorkspaceActors: function(showAnimation) {
        let active = global.workspace_manager.get_active_workspace_index();

        // Animation is turned off in a multi-manager scenario till we fix
        // the animations so that they respect the monitor boundaries.
        this._animating = Main.layoutManager.monitors.length < 2 && showAnimation;

        for (let w = 0; w < this._workspaces.length; w++) {
            let workspace = this._workspaces[w];

            workspace.actor.remove_all_transitions();

            let x = (w - active) * (this._width + this._spacing + this._workspaceRatioSpacing);

            if (this._animating) {
                let params = { x: x,
                               duration: WORKSPACE_SWITCH_TIME,
                               mode: Clutter.AnimationMode.EASE_OUT_QUAD
                             };
                // we have to call _updateVisibility() once before the
                // animation and once afterwards - it does not really
                // matter which tween we use, so we pick the first one ...
                if (w == 0) {
                    this._updateVisibility();
                    params.onComplete = () => {
                            this._animating = false;
                            this._updateVisibility();
                    };
                }

                workspace.actor.ease(params);
            } else if (!workspace.actor.is_finalized()) {
                workspace.actor.set_position(x, 0);
                if (w == 0)
                    this._updateVisibility();
            }
        }
    },

    _updateVisibility: function() {
        let active = global.workspace_manager.get_active_workspace_index();

        for (let w = 0; w < this._workspaces.length; w++) {
            let workspace = this._workspaces[w];
            if (this._animating || this._scrolling) {
                workspace.hideWindowsOverlays();
                workspace.actor.show();
            } else if (!workspace.actor.is_finalized()) {
                workspace.showWindowsOverlays();
                workspace.actor.visible = (w == active);
            }
        }
    },

    _updateScrollAdjustment: function(index, showAnimation) {
        if (this._scrolling)
            return;

        this._animatingScroll = true;

        if (showAnimation) {
            this._scrollAdjustment.ease({
                value: index,
                duration: WORKSPACE_SWITCH_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._animatingScroll = false;
                }
            });
        } else {
            this._scrollAdjustment.value = index;
            this._animatingScroll = false;
        }
        let active = global.workspace_manager.get_active_workspace_index();
        this._workspaces[active].zoomToOverview();
    },

    _workspacesChanged: function() {
        let removedCount = 0;
        this._workspaces.slice().forEach(function(workspace, i) {
            let metaWorkspace = global.workspace_manager.get_workspace_by_index(i - removedCount);
            if (workspace.metaWorkspace != metaWorkspace) {
                workspace.actor.remove_all_transitions();
                workspace.destroy();
                this._workspaces.splice(i - removedCount, 1);
                ++removedCount;
            }
        }, this);

        while (global.workspace_manager.n_workspaces > this._workspaces.length) {
            let lastWs = global.workspace_manager.get_workspace_by_index(this._workspaces.length);
            let workspace = new Workspace.Workspace(lastWs, this);
            this._workspaces.push(workspace);
            this.actor.add_actor(workspace.actor);
        }
        this._scrollAdjustment.upper = Math.max(1, this._workspaces.length);
        this._animating = false;
        this._updateVisibility();
    },

    _activeWorkspaceChanged: function(wm, from, to, direction) {
        if (this._scrolling)
            return;

        this._keyIsHandled = true;

        let active = global.workspace_manager.get_active_workspace_index();
        if (this._pendingSwipeCommitIndex === active) {
            this._pendingSwipeCommitIndex = -1;
            return;
        }

        this._pendingSwipeCommitIndex = -1;
        this._scrollToActive(true);
    },

    _onDestroy: function() {
        this._cancelSwipeSettle(false);
        this._removeWindowDragMonitor();
        this._windowDragSource = null;
        this._pendingSwipeCommitIndex = -1;
        this._scrollAdjustment.run_dispose();
        this._disconnectHandlers();
    },

    _onMappedChanged: function() {
        if (this.actor.mapped) {
            let direction = SwipeScrollDirection.HORIZONTAL;
            Main.overview.setScrollAdjustment(this._scrollAdjustment,
                                              direction);
            if (this._swipeScrollBeginId === 0) {
                this._swipeScrollBeginId = Main.overview.connect(
                    'swipe-scroll-begin',
                    Lang.bind(this, this._swipeScrollBegin)
                );
            }
            if (this._swipeScrollEndId === 0) {
                this._swipeScrollEndId = Main.overview.connect(
                    'swipe-scroll-end',
                    Lang.bind(this, this._swipeScrollEnd)
                );
            }
            return;
        }

        // WorkspacesView is repeatedly hidden for Apps/Search. Cancel while
        // our handlers are still connected, then disconnect so remapping cannot
        // accumulate duplicate listeners or leave _scrolling stuck at true.
        Main.overview.setScrollAdjustment(
            null,
            SwipeScrollDirection.NONE
        );
        if (this._swipeScrollBeginId > 0) {
            Main.overview.disconnect(this._swipeScrollBeginId);
            this._swipeScrollBeginId = 0;
        }
        if (this._swipeScrollEndId > 0) {
            Main.overview.disconnect(this._swipeScrollEndId);
            this._swipeScrollEndId = 0;
        }
        this._cancelSwipeSettle(true);
        this._scrolling = false;
        this._animatingScroll = false;
        this._swipeStartIndex = -1;
        this._pendingSwipeCommitIndex = -1;
    },

    _cancelScrollAdjustmentTransitions: function() {
        if (!this._scrollAdjustment)
            return;

        try {
            if (typeof this._scrollAdjustment.remove_all_transitions ===
                'function') {
                this._scrollAdjustment.remove_all_transitions();
            } else if (typeof this._scrollAdjustment.remove_transition ===
                       'function') {
                this._scrollAdjustment.remove_transition('value');
            }
        } catch (e) {
            global.logError(
                'Unable to cancel Overview scroll adjustment transition: ' + e
            );
        }
    },

    _syncSwipePosition: function(index) {
        index = Math.max(0, Math.min(this._workspaces.length - 1, index));
        this._animating = false;
        this._animatingScroll = true;
        try {
            this._cancelScrollAdjustmentTransitions();
            this._scrollAdjustment.value = index;
        } finally {
            this._animatingScroll = false;
        }
        this._updateWorkspaceActors(false);
        this._updateVisibility();
    },

    _cancelSwipeSettle: function(snapToActive) {
        if (this._swipeSettleTimeoutId) {
            Mainloop.source_remove(this._swipeSettleTimeoutId);
            this._swipeSettleTimeoutId = 0;
        }

        this._swipeSettleGeneration++;
        for (let workspace of this._workspaces)
            workspace.actor.remove_all_transitions();

        this._animating = false;
        if (snapToActive) {
            let active = global.workspace_manager.get_active_workspace_index();
            this._syncSwipePosition(active);
        }
    },

    _animateSwipeSettle: function(startPositions, targetIndex) {
        this._cancelSwipeSettle(false);

        let generation = ++this._swipeSettleGeneration;
        let duration = Main.animations_enabled ? 190 : 0;
        let spacing = this._width + this._spacing +
                      this._workspaceRatioSpacing;
        this._animating = duration > 0;
        let finished = false;

        let finish = () => {
            if (finished || generation !== this._swipeSettleGeneration)
                return;
            finished = true;

            if (this._swipeSettleTimeoutId) {
                Mainloop.source_remove(this._swipeSettleTimeoutId);
                this._swipeSettleTimeoutId = 0;
            }

            this._animating = false;
            for (let i = 0; i < this._workspaces.length; i++) {
                let actor = this._workspaces[i].actor;
                actor.remove_all_transitions();
                actor.x = (i - targetIndex) * spacing;
            }
            this._updateVisibility();
        };

        for (let i = 0; i < this._workspaces.length; i++) {
            let workspace = this._workspaces[i];
            let actor = workspace.actor;
            let finalX = (i - targetIndex) * spacing;
            let startX = Number(startPositions[i]);
            if (!isFinite(startX))
                startX = actor.x;

            actor.remove_all_transitions();
            actor.x = startX;
            actor.show();
            workspace.hideWindowsOverlays();

            if (duration === 0) {
                actor.x = finalX;
                continue;
            }

            let params = {
                x: finalX,
                duration: duration,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC
            };
            if (i === 0) {
                params.onComplete = finish;
                params.onStopped = finish;
            }
            actor.ease(params);
        }

        if (duration === 0) {
            finish();
            return;
        }

        this._swipeSettleTimeoutId = Mainloop.timeout_add(
            duration + 140,
            () => {
                this._swipeSettleTimeoutId = 0;
                finish();
                return false;
            }
        );
    },

    _swipeScrollBegin: function() {
        // Mark the logical gesture active before any optional animation
        // cleanup. A missing transition API on St.Adjustment must never leave
        // the WorkspacesView believing no swipe is in progress.
        this._scrolling = true;
        this._swipeStartIndex =
            global.workspace_manager.get_active_workspace_index();
        this._pendingSwipeCommitIndex = -1;
        this._animatingScroll = false;

        this._cancelSwipeSettle(true);
        this._cancelScrollAdjustmentTransitions();
    },

    _swipeScrollEnd: function(overview, result, requestedValue) {
        let startPositions = this._workspaces.map(workspace =>
            Number(workspace.actor.x));
        let requestedIndex = Number.isFinite(Number(requestedValue))
            ? Math.round(Number(requestedValue))
            : Math.round(this._scrollAdjustment.value);

        if ((result === SwipeScrollResult.CANCEL ||
             result === SwipeScrollResult.CLICK) &&
            this._swipeStartIndex >= 0)
            requestedIndex = this._swipeStartIndex;

        // Never carry a fractional adjustment into the next gesture.
        let targetIndex = Math.max(
            0,
            Math.min(this._workspaces.length - 1, requestedIndex)
        );
        let activeIndex = global.workspace_manager.get_active_workspace_index();

        // Commit the logical state synchronously. Visual settling is separate
        // and may be interrupted without leaving input locked or the
        // adjustment between pages.
        this._scrolling = false;
        this._animatingScroll = true;
        try {
            this._cancelScrollAdjustmentTransitions();
            this._scrollAdjustment.value = targetIndex;

            if (targetIndex !== activeIndex) {
                this._pendingSwipeCommitIndex = targetIndex;
                this._workspaces[targetIndex].metaWorkspace.activate(
                    global.get_current_time()
                );
            } else {
                this._pendingSwipeCommitIndex = -1;
            }
        } catch (e) {
            this._pendingSwipeCommitIndex = -1;
            global.logError('Unable to commit Overview workspace swipe: ' + e);

            // A failed Meta.Workspace activation must not leave the visual
            // strip on a workspace that never became active.
            targetIndex = activeIndex;
            try {
                this._scrollAdjustment.value = targetIndex;
            } catch (snapError) {
                global.logError(
                    'Unable to snap Overview scroll adjustment: ' + snapError
                );
            }
        } finally {
            this._animatingScroll = false;
            this._scrolling = false;
            this._swipeStartIndex = -1;
        }

        try {
            this._animateSwipeSettle(startPositions, targetIndex);
        } catch (e) {
            global.logError('Unable to animate Overview workspace settle: ' + e);
            this._syncSwipePosition(targetIndex);
        }

        Main.wm.showWorkspaceOSD();

        if (result === SwipeScrollResult.CLICK) {
            let active = global.workspace_manager.get_active_workspace_index();
            if (this._workspaces[active].isEmpty())
                Main.overview.hide();
        }
    },

    _onRestacked: function() {
        let stack = global.get_window_actors().reverse();
        let stackIndices = {};

        for (let i = 0; i < stack.length; i++) {
            // Use the stable sequence for an integer to use as a hash key
            stackIndices[stack[i].get_meta_window().get_stable_sequence()] = i;
        }

        for (let j = 0; j < this._workspaces.length; j++)
            this._workspaces[j].syncStacking(stackIndices);
    },

    // sync the workspaces' positions to the value of the scroll adjustment
    // and change the active workspace if appropriate
    _onScroll: function(adj) {
        if (this._animatingScroll)
            return;

        let active = global.workspace_manager.get_active_workspace_index();
        let current = Math.max(
            0,
            Math.min(this._workspaces.length - 1, Math.round(adj.value))
        );

        // While the pointer is held, move only the visual workspace strip.
        // Activating a Meta.Workspace at the half-way point races the pointer
        // grab and can leave the adjustment between pages if the settle
        // transition is interrupted. Commit exactly once in _swipeScrollEnd().
        if (!this._scrolling && active != current) {
            let metaWorkspace = this._workspaces[current].metaWorkspace;
            metaWorkspace.activate(global.get_current_time());
        }

        let last = this._workspaces.length - 1;
        let firstWorkspaceX = this._workspaces[0].actor.x;
        let lastWorkspaceX = this._workspaces[last].actor.x;
        let workspacesWidth = lastWorkspaceX - firstWorkspaceX;

        if (adj.upper == 1)
            return;

        let currentX = firstWorkspaceX;
        let newX =  - adj.value / (adj.upper - 1) * workspacesWidth;

        let dx = newX - currentX;

        for (let i = 0; i < this._workspaces.length; i++) {
            this._workspaces[i].hideWindowsOverlays();
            this._workspaces[i].actor.visible = Math.abs(i - adj.value) <= 1;
            this._workspaces[i].actor.x += dx;
        }
    },

    _onScrollEvent: function (actor, event) {
        switch ( event.get_scroll_direction() ) {
        case Clutter.ScrollDirection.UP:
            Main.wm.actionMoveWorkspaceUp();
            break;
        case Clutter.ScrollDirection.DOWN:
            Main.wm.actionMoveWorkspaceDown();
            break;
        }
    }
};
Signals.addSignalMethods(WorkspacesView.prototype);
