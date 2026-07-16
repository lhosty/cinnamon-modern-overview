#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'patched', name), 'utf8');
const main = read('main.js');
const overview = read('overview.js');
const workspaces = read('workspacesView.js');
const panel = read('panel.js');
const workspace = read('workspace.js');

let passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log('PASS ' + name);
}

function functionBody(source, signature, nextSignature) {
    const start = source.indexOf(signature);
    assert(start >= 0, 'missing ' + signature);
    const end = source.indexOf(nextSignature, start);
    assert(end > start, 'missing end marker for ' + signature);
    return source.slice(start, end);
}

test('production bundle has no diagnostic logging', () => {
    for (const file of ['main.js', 'overview.js', 'workspace.js', 'workspacesView.js'])
        assert(!read(file).includes('[OVM-DIAG]'));
});


test('Super integration has no project-specific GSettings dependency', () => {
    for (const token of [
        'org.cinnamon.overview-modern',
        'use-super-key',
        '_overviewSuperEnabled',
        '_overviewPreferences',
        '_loadOverviewPreferences'
    ])
        assert(!main.includes(token), 'unexpected legacy token: ' + token);
});

test('overlay-key handler and reservation are registered unconditionally', () => {
    const initBody = functionBody(main,
        'function _initUserSession() {',
        '\nfunction _loadOskLayouts() {');
    assert(initBody.includes("Meta.keybindings_set_custom_handler(\n            'overlay-key',"));
    assert(!initBody.includes('_overviewSuperEnabled'));

    const startup = functionBody(main,
        'function start() {',
        '\nfunction _stageEventHandler(actor, event) {');
    assert(startup.includes('_registerOverviewSuperBindings();'));
});

test('modal Super interception is unconditional', () => {
    const body = functionBody(main,
        'function _stageEventHandler(actor, event) {',
        '\nfunction _findModal(actor) {');
    assert(body.includes('if (isSuper) {'));
    assert(!body.includes('_overviewSuperEnabled'));
});

test('modal Super is handled before generic keybinding dispatch', () => {
    const body = functionBody(main,
        'function _stageEventHandler(actor, event) {',
        '\nfunction _findModal(actor) {');
    const superPress = body.indexOf("eventType === Clutter.EventType.KEY_PRESS");
    const consume = body.indexOf('return true;', superPress);
    const generic = body.indexOf('keybindingManager.invoke_keybinding_action_by_id(action);');
    assert(superPress >= 0 && consume > superPress && generic > consume);
});

test('modal Super dispatches on release, not press', () => {
    const body = functionBody(main,
        'function _stageEventHandler(actor, event) {',
        '\nfunction _findModal(actor) {');
    const releaseBranch = body.indexOf('Clutter.EventType.KEY_RELEASE');
    const dispatch = body.indexOf('_onSuperKeyPressed();', releaseBranch);
    assert(releaseBranch >= 0 && dispatch > releaseBranch);
    const pressBranch = body.indexOf('Clutter.EventType.KEY_PRESS');
    const pressEnd = body.indexOf('} else if (eventType === Clutter.EventType.KEY_RELEASE)', pressBranch);
    assert(!body.slice(pressBranch, pressEnd).includes('_onSuperKeyPressed();'));
});

test('duplicate physical Super release is consumed once', () => {
    assert(main.includes('_lastOverviewStageSuperReleaseTime'));
    assert(main.includes('eventTime === _lastOverviewStageSuperReleaseTime'));
    assert(main.includes('if (duplicateRelease)\n                    return true;'));
});

test('Super plus another key cancels bare-Super activation', () => {
    assert(main.includes('_overviewStageSuperCancelled = true;'));
    assert(main.includes('!_overviewStageSuperCancelled && overviewOwnsModal'));
});

test('overlay-key is ignored while physical modal path is authoritative', () => {
    const body = functionBody(main,
        'function _onOverviewSuperHotKeyActivated() {',
        '\nfunction _registerOverviewSuperBindings() {');
    assert(body.includes('modalCount > 0 && overview && overview.visible'));
    assert(body.indexOf('return;') < body.lastIndexOf('_onSuperKeyPressed();'));
});

test('Overview owns the 400 ms double-activation invariant', () => {
    assert(overview.includes('const SHORTCUT_DOUBLE_TAP_MS = 400;'));
    assert(overview.includes('const SHORTCUT_CLOSE_TIME = SHORTCUT_DOUBLE_TAP_MS;'));
    assert(overview.includes('if (isDoubleTap)'));
    assert(overview.includes('this.showAppGrid();'));
});




test('single Super uses the recognition window as a visible close animation', () => {
    assert(overview.includes('const OVERVIEW_HIDE_TIME = 180;'));
    const armBody = functionBody(overview,
        '    _armShortcutSequence: function(startState) {',
        '\n    _beginShortcutClosePreview: function(');
    assert(armBody.includes("startState === 'workspaces'"));
    assert(armBody.includes('this._beginShortcutClosePreview(generation)'));

    const previewBody = functionBody(overview,
        '    _beginShortcutClosePreview: function(',
        '\n    toggle: function() {');
    assert(previewBody.includes('SHORTCUT_CLOSE_TIME'));
    assert(previewBody.includes('Clutter.AnimationMode.EASE_OUT_QUAD'));
    assert(previewBody.includes('this._hideDone(animationGeneration);'));
    assert(!previewBody.includes('Mainloop.timeout_add'));
});

test('show requests reverse a close before the already-shown fast path', () => {
    const body = functionBody(overview,
        '    _showView: function(mode) {',
        '\n    getSuperKeyState: function() {');
    const reverse = body.indexOf('this._reverseHideToVisible(mode);');
    const alreadyShown = body.indexOf('if (wasShown)');
    assert(reverse >= 0 && alreadyShown > reverse);
});

test('heavy teardown is deferred until after desktop interaction is restored', () => {
    const body = functionBody(overview,
        '    _hideDone: function(generation) {',
        '\n    }\n};');
    const hideGroup = body.indexOf('this._group.hide();');
    const syncInput = body.indexOf('this._syncInputMode();');
    const schedule = body.indexOf('this._scheduleDeferredTeardown();');
    assert(hideGroup >= 0 && syncInput > hideGroup && schedule > syncInput);
    assert(!body.includes('this.workspacesView.destroy();'));

    const teardown = functionBody(overview,
        '    _scheduleDeferredTeardown: function() {',
        '\n    _flushDeferredTeardown: function() {');
    assert(teardown.includes('Mainloop.idle_add'));
    assert(teardown.includes('this._destroyOverviewActors();'));
});

test('shortcut model starts close immediately and reverses a double tap', () => {
    const windowMs = 400;
    let state = 'closed';
    let pending = null;
    let closeProgress = 0;

    function activate(now) {
        const isDouble = pending && now - pending.time <= windowMs;
        if (isDouble) {
            pending = null;
            closeProgress = 0;
            state = 'app-grid';
            return;
        }

        const start = state;
        pending = { time: now, start };
        if (start === 'closed' || start === 'app-grid')
            state = 'workspaces';
        else
            closeProgress = 0.01;
    }

    function advance(now) {
        if (!pending)
            return;
        let elapsed = now - pending.time;
        if (pending.start === 'workspaces')
            closeProgress = Math.min(1, elapsed / windowMs);
        if (elapsed >= windowMs) {
            const start = pending.start;
            pending = null;
            if (start === 'workspaces') {
                closeProgress = 1;
                state = 'closed';
            }
        }
    }

    activate(0);
    assert.strictEqual(state, 'workspaces');
    activate(220);
    assert.strictEqual(state, 'app-grid');

    activate(1000);
    assert.strictEqual(state, 'workspaces');
    advance(1500);
    assert.strictEqual(state, 'workspaces');

    activate(2000);
    advance(2100);
    assert(closeProgress > 0 && closeProgress < 1);
    activate(2250);
    assert.strictEqual(state, 'app-grid');
    assert.strictEqual(closeProgress, 0);

    state = 'workspaces';
    activate(3000);
    advance(3400);
    assert.strictEqual(state, 'closed');
    assert.strictEqual(closeProgress, 1);
});



test('Overview uses panel overview mode instead of opacity disable/enable', () => {
    assert(overview.includes('Main.panelManager.enterOverviewMode();'));
    assert(overview.includes('Main.panelManager.leaveOverviewMode();'));
    assert(!overview.includes('Main.panelManager.disablePanels();'));
    assert(!overview.includes('Main.panelManager.enablePanels();'));
});

test('panel manager exposes overview enter and leave fan-out', () => {
    const managerEnter = functionBody(panel,
        '    enterOverviewMode: function() {',
        '\n    /**\n     * leaveOverviewMode:');
    assert(managerEnter.includes('this.panels[i].enterOverviewMode();'));

    const managerLeave = functionBody(panel,
        '    leaveOverviewMode: function() {',
        '\n    /**\n     * setPanelsOpacity:');
    assert(managerLeave.includes('this.panels[i].leaveOverviewMode();'));
});

test('panel overview mode forces a fully visible dock without changing strut mode', () => {
    const panelEnterStart = panel.indexOf('    enterOverviewMode: function() {', panel.indexOf('    _forceOverviewPanelVisible: function() {'));
    const panelEnterEnd = panel.indexOf('\n    leaveOverviewMode: function() {', panelEnterStart);
    const enter = panel.slice(panelEnterStart, panelEnterEnd);
    assert(enter.includes('this._forceOverviewPanelVisible();'));
    assert(enter.includes('this._overviewWasDisabled = this._disabled;'));
    assert(!enter.includes('modifyActorParams'));

    const force = functionBody(panel,
        '    _forceOverviewPanelVisible: function() {',
        '\n    enterOverviewMode: function() {');
    assert(force.includes('this.actor.opacity = 255;'));
    assert(force.includes('this._movePanelFullyOnscreen();'));
    assert(force.includes('this._hidden = false;'));
});

test('panel exit keeps always-visible mode instant and re-evaluates hideable modes', () => {
    const panelLeaveStart = panel.indexOf('    leaveOverviewMode: function() {', panel.indexOf('    _forceOverviewPanelVisible: function() {'));
    const panelLeaveEnd = panel.indexOf('\n    /**\n     * _panelHasOpenMenus:', panelLeaveStart);
    const leave = panel.slice(panelLeaveStart, panelLeaveEnd);
    assert(leave.includes('this._autohideSettings == "false"'));
    assert(leave.includes('this._forceOverviewPanelVisible();'));
    assert(leave.includes('this._updatePanelVisibility();'));
});

test('intellihide recalculates when focus becomes null', () => {
    const body = functionBody(panel,
        '    _onFocusChanged: function() {',
        '\n    _processPanelAutoHide: function() {');
    assert(body.includes('this._focusWindow = focusWindow || null;'));
    assert(body.includes('this._updatePanelVisibility();'));
    assert(!body.includes('if (!global.display.focus_window)\n            return;'));
});

test('overview content geometry reserves panel edges on every monitor', () => {
    const overviewBody = functionBody(overview,
        '    _getOverviewMonitorGeometry: function(monitorIndex) {',
        '\n    _animateVisible: function() {');
    assert(overviewBody.includes('Main.panelManager.getOverviewMonitorGeometry(monitorIndex)'));

    const managerStart = panel.indexOf('    getOverviewMonitorGeometry: function(monitorIndex) {');
    const managerEnd = panel.indexOf('\n    /**\n     * setPanelsOpacity:', managerStart);
    const managerBody = panel.slice(managerStart, managerEnd);
    assert(managerBody.includes('this.getPanelsInMonitor(monitorIndex)'));
    assert(managerBody.includes('case PanelLoc.top'));
    assert(managerBody.includes('case PanelLoc.bottom'));
    assert(managerBody.includes('case PanelLoc.left'));
    assert(managerBody.includes('case PanelLoc.right'));
});

test('St.Adjustment transition cleanup is capability checked', () => {
    assert(workspaces.includes('_cancelScrollAdjustmentTransitions: function()'));
    assert(workspaces.includes("typeof this._scrollAdjustment.remove_all_transitions ==="));
    assert(workspaces.includes("typeof this._scrollAdjustment.remove_transition ==="));
});

test('swipe begin marks scrolling before optional cleanup', () => {
    const body = functionBody(workspaces,
        '    _swipeScrollBegin: function() {',
        '\n    _swipeScrollEnd: function(');
    const scrolling = body.indexOf('this._scrolling = true;');
    const settle = body.indexOf('this._cancelSwipeSettle(true);');
    const adjustment = body.indexOf('this._cancelScrollAdjustmentTransitions();');
    assert(scrolling >= 0 && settle > scrolling && adjustment > settle);
});

test('swipe end rounds and clamps the requested workspace', () => {
    const body = functionBody(workspaces,
        '    _swipeScrollEnd: function(',
        '\n    _onRestacked: function() {');
    assert(body.includes('Math.round(Number(requestedValue))'));
    assert(body.includes('Math.min(this._workspaces.length - 1, requestedIndex)'));
    assert(body.includes('this._scrollAdjustment.value = targetIndex;'));
});

test('swipe end always unlocks logical state', () => {
    const body = functionBody(workspaces,
        '    _swipeScrollEnd: function(',
        '\n    _onRestacked: function() {');
    assert(body.includes('} finally {'));
    assert(body.includes('this._animatingScroll = false;'));
    assert(body.includes('this._scrolling = false;'));
    assert(body.includes('this._swipeStartIndex = -1;'));
});

test('no unsafe direct adjustment transition removal remains', () => {
    const occurrences = [...workspaces.matchAll(/this\._scrollAdjustment\.remove_all_transitions\(\)/g)];
    assert.strictEqual(occurrences.length, 1, 'only helper implementation may call it');
    const helperStart = workspaces.indexOf('_cancelScrollAdjustmentTransitions: function()');
    assert(occurrences[0].index > helperStart);
});

// Behavioral routing model for the confirmed Cinnamon 6.6.7 event order.
test('routing model: second Super cannot reach generic close action', () => {
    let dispatches = 0;
    let genericInvocations = 0;
    let pressed = false;
    let cancelled = false;
    let lastRelease = 0;

    function stage(type, symbol, time, overviewOwnsModal) {
        const isSuper = symbol === 'Super_L' || symbol === 'Super_R';
        if (isSuper) {
            if (type === 'press') {
                if (pressed) return true;
                if (overviewOwnsModal) {
                    pressed = true;
                    cancelled = false;
                    return true;
                }
            } else {
                const duplicate = time > 0 && time === lastRelease;
                if (pressed || duplicate) {
                    const shouldDispatch = pressed && !cancelled && overviewOwnsModal;
                    pressed = false;
                    cancelled = false;
                    if (duplicate) return true;
                    lastRelease = time;
                    if (shouldDispatch) dispatches++;
                    return true;
                }
            }
        }
        if (pressed && type === 'press' && !isSuper)
            cancelled = true;
        if (type === 'press') genericInvocations++;
        return false;
    }

    assert.strictEqual(stage('press', 'Super_L', 100, true), true);
    assert.strictEqual(stage('release', 'Super_L', 180, true), true);
    assert.strictEqual(stage('release', 'Super_L', 180, true), true);
    assert.strictEqual(dispatches, 1);
    assert.strictEqual(genericInvocations, 0);
});

test('routing model: Super plus key cancels only the bare-Super action', () => {
    let dispatches = 0;
    let genericInvocations = 0;
    let pressed = false;
    let cancelled = false;
    function stage(type, symbol) {
        const isSuper = symbol.startsWith('Super');
        if (isSuper && type === 'press') {
            pressed = true;
            cancelled = false;
            return true;
        }
        if (pressed && type === 'press' && !isSuper)
            cancelled = true;
        if (isSuper && type === 'release' && pressed) {
            if (!cancelled) dispatches++;
            pressed = false;
            cancelled = false;
            return true;
        }
        if (type === 'press') genericInvocations++;
        return false;
    }
    stage('press', 'Super_L');
    stage('press', 'R');
    stage('release', 'Super_L');
    assert.strictEqual(dispatches, 0);
    assert.strictEqual(genericInvocations, 1);
});

test('swipe model works when Adjustment has no transition removal API', () => {
    const adjustment = { value: 0.6388 };
    let scrolling = false;
    let animating = false;
    let activated = -1;
    const workspacesCount = 4;

    function cancelTransitions() {
        if (typeof adjustment.remove_all_transitions === 'function')
            adjustment.remove_all_transitions();
        else if (typeof adjustment.remove_transition === 'function')
            adjustment.remove_transition('value');
    }

    scrolling = true;
    cancelTransitions();
    assert.strictEqual(scrolling, true);

    const requested = 1.6388;
    const target = Math.max(0, Math.min(workspacesCount - 1, Math.round(requested)));
    scrolling = false;
    animating = true;
    try {
        cancelTransitions();
        adjustment.value = target;
        activated = target;
    } finally {
        animating = false;
        scrolling = false;
    }
    assert.strictEqual(adjustment.value, 2);
    assert.strictEqual(activated, 2);
    assert.strictEqual(scrolling, false);
    assert.strictEqual(animating, false);
});


test('window arrow navigation uses visual actor geometry', () => {
    const body = functionBody(workspace,
        '    _selectWindowByVisualDirection: function(symbol) {',
        '\n    selectAnotherWindow: function(symbol) {');
    assert(body.includes('clone.actor.get_transformed_position()') ||
           workspace.includes('clone.actor.get_transformed_position()'));
    assert(body.includes('clone.actor.get_transformed_size()') ||
           workspace.includes('clone.actor.get_transformed_size()'));
    assert(body.includes('let primary = horizontal ? direction * dx : direction * dy;'));
    assert(body.includes('let cross = Math.abs(horizontal ? dy : dx);'));
    assert(body.includes('let score = primary + cross * 2.5;'));
});

test('arrow navigation prefers the same visual row before a diagonal window', () => {
    const points = [
        { x: 300, y: 200 },
        { x: 700, y: 200 },
        { x: 500, y: 500 }
    ];

    function next(currentIndex, horizontal, direction) {
        const current = points[currentIndex];
        let bestIndex = -1;
        let bestScore = Infinity;
        let bestPrimary = Infinity;
        for (let i = 0; i < points.length; i++) {
            if (i === currentIndex) continue;
            const dx = points[i].x - current.x;
            const dy = points[i].y - current.y;
            const primary = horizontal ? direction * dx : direction * dy;
            if (primary <= 2) continue;
            const cross = Math.abs(horizontal ? dy : dx);
            const score = primary + cross * 2.5;
            if (score < bestScore - 0.01 ||
                (Math.abs(score - bestScore) <= 0.01 && primary < bestPrimary)) {
                bestIndex = i;
                bestScore = score;
                bestPrimary = primary;
            }
        }
        return bestIndex;
    }

    assert.strictEqual(next(0, true, 1), 1,
        'Right from upper-left must select upper-right, not the lower window');
    assert.strictEqual(next(1, true, -1), 0,
        'Left from upper-right must select upper-left');
});

test('centered incomplete row keeps physical left and right semantics', () => {
    const points = [
        { x: 300, y: 200 },
        { x: 700, y: 200 },
        { x: 500, y: 500 }
    ];

    function nextFromBottom(direction) {
        const current = points[2];
        let bestIndex = -1;
        let bestScore = Infinity;
        for (let i = 0; i < 2; i++) {
            const dx = points[i].x - current.x;
            const dy = points[i].y - current.y;
            const primary = direction * dx;
            if (primary <= 2) continue;
            const score = primary + Math.abs(dy) * 2.5;
            if (score < bestScore) {
                bestIndex = i;
                bestScore = score;
            }
        }
        return bestIndex;
    }

    assert.strictEqual(nextFromBottom(-1), 0,
        'Left from lower centered window must select the visual left window');
    assert.strictEqual(nextFromBottom(1), 1,
        'Right from lower centered window must select the visual right window');
});

test('GridNavigator remains as a compatibility fallback', () => {
    const body = functionBody(workspace,
        '    selectAnotherWindow: function(symbol) {',
        '\n    showActiveSelection: function() {');
    const visual = body.indexOf('this._selectWindowByVisualDirection(symbol)');
    const fallback = body.indexOf('GridNavigator.nextIndex(');
    assert(visual >= 0 && fallback > visual);
});

console.log(`\n${passed} tests passed`);
