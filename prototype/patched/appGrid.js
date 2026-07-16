// appGrid.js - Scrollable application grid for the Cinnamon Overview.
// The application catalog is cached, the visual grid is built lazily, and a
// single shared context menu serves both grid items and search results.

const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Cinnamon = imports.gi.Cinnamon;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;

const ICON_SIZE = 64;
const CELL_PAD = 14;
const CELL_GAP = 14;
const CELL_WIDTH = 112;
const ROW_GAP = 12;
const SIDE_PAD = 36;
const TOP_PAD = 18;
const MIN_COLS = 1;
const MAX_COLS = 12;
const MAX_CONTEXT_WINDOWS = 12;

const APP_BUTTON_NORMAL_STYLE =
    'padding: 0; border-radius: 18px;' +
    'background-color: rgba(255,255,255,0.00);' +
    'border: 1px solid rgba(255,255,255,0.00);';
const APP_BUTTON_ACTIVE_STYLE =
    'padding: 0; border-radius: 18px;' +
    'background-color: rgba(255,255,255,0.115);' +
    'border: 1px solid rgba(255,255,255,0.11);' +
    'box-shadow: 0 10px 24px rgba(0,0,0,0.20);';

let _catalogAppSystem = null;
let _appCatalogCache = null;
let _windowFocusIconName = null;

function _getWindowFocusIconName() {
    if (_windowFocusIconName)
        return _windowFocusIconName;

    let candidates = [
        'focus-windows-symbolic',
        'preferences-system-windows-symbolic',
        'preferences-system-windows',
        'window-new-symbolic',
        'application-x-executable-symbolic'
    ];

    try {
        let theme = Gtk.IconTheme.get_default();
        if (theme) {
            for (let i = 0; i < candidates.length; i++) {
                if (theme.has_icon(candidates[i])) {
                    _windowFocusIconName = candidates[i];
                    return _windowFocusIconName;
                }
            }
        }
    } catch (e) {}

    _windowFocusIconName = 'application-x-executable-symbolic';
    return _windowFocusIconName;
}

function _addLeadingMenuIcon(menuItem, iconName) {
    if (!menuItem || typeof menuItem.addActor !== 'function')
        return;

    let icon = new St.Icon({
        style_class: 'popup-menu-icon',
        icon_name: iconName,
        icon_type: St.IconType.SYMBOLIC
    });
    menuItem.addActor(icon, { span: 0, position: 0 });
}

function _normalize(text) {
    let value = String(text || '').toLocaleLowerCase();

    try {
        return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {
        return value;
    }
}

function _singleLine(text, maxLength) {
    let value = String(text || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (maxLength > 0 && value.length > maxLength)
        return value.slice(0, Math.max(1, maxLength - 1)) + '…';

    return value;
}


// Search metadata is prepared once per installed application. Query-time work
// then stays limited to comparisons against short normalized strings and word
// arrays, which is fast enough to run immediately on every keystroke.
const MAX_FUZZY_APP_COMPARISONS = 1400;

function _normalizeSearchPhrase(text) {
    return _normalize(text)
        .replace(/[._\-\/:;,()\[\]{}]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function _searchWords(text) {
    let normalized = _normalizeSearchPhrase(text);
    return normalized ? normalized.split(' ').filter(word => word.length > 0) : [];
}

function _makeInitials(words) {
    let initials = '';
    for (let i = 0; i < words.length; i++) {
        if (words[i])
            initials += words[i].charAt(0);
    }
    return initials;
}

function _buildAppSearchMetadata(displayName, description, keywords, desktopId) {
    let safeName = _singleLine(displayName, 160);
    let safeDescription = _singleLine(description, 240);
    let safeKeywords = _singleLine(keywords, 320);
    let safeDesktopId = _singleLine(desktopId, 240);
    let name = _normalizeSearchPhrase(safeName);
    let descriptionSearch = _normalizeSearchPhrase(safeDescription);
    let keywordsSearch = _normalizeSearchPhrase(safeKeywords);
    let idSearch = _normalizeSearchPhrase(
        safeDesktopId.replace(/\.desktop$/i, '')
    );
    let nameWords = _searchWords(safeName);
    let descriptionWords = _searchWords(safeDescription);
    let keywordWords = _searchWords(safeKeywords);
    let idWords = _searchWords(safeDesktopId.replace(/\.desktop$/i, ''));

    return {
        displayName: safeName,
        description: safeDescription,
        keywords: safeKeywords,
        desktopId: safeDesktopId,
        name: name,
        descriptionSearch: descriptionSearch,
        keywordsSearch: keywordsSearch,
        idSearch: idSearch,
        nameWords: nameWords,
        descriptionWords: descriptionWords,
        keywordWords: keywordWords,
        idWords: idWords,
        initials: _makeInitials(nameWords),
        compactName: nameWords.join(''),
        searchText: [
            name,
            descriptionSearch,
            keywordsSearch,
            idSearch
        ].filter(value => value.length > 0).join(' ')
    };
}

function prepareAppSearchQuery(value) {
    let normalized = _normalizeSearchPhrase(_singleLine(value, 256));
    let words = normalized
        ? normalized.split(' ').filter(word => word.length > 0)
        : [];

    return {
        normalized: normalized,
        words: words,
        compact: words.join('')
    };
}

function _bestWordScore(words, token, exactScore, prefixScore, containsScore) {
    let best = 0;

    for (let i = 0; i < words.length; i++) {
        let word = words[i];
        let score = 0;

        if (word === token)
            score = exactScore;
        else if (word.indexOf(token) === 0)
            score = prefixScore;
        else if (word.indexOf(token) !== -1)
            score = containsScore;

        // Earlier words are normally more representative of the app's title.
        if (score > 0)
            score -= Math.min(12, i * 2);
        if (score > best)
            best = score;
    }

    return best;
}

function _appIsRunning(entry) {
    try {
        return entry.app &&
               typeof entry.app.get_n_windows === 'function' &&
               entry.app.get_n_windows() > 0;
    } catch (e) {
        return false;
    }
}

function _scoreDirectAppEntry(entry, query) {
    if (!entry || query.words.length === 0)
        return null;

    let name = entry.name || _normalizeSearchPhrase(entry.displayName || '');
    let score = 0;
    let phraseIndex = name.indexOf(query.normalized);

    if (name === query.normalized) {
        score += 1400;
    } else if (phraseIndex === 0) {
        score += 1100 - Math.min(120, name.length - query.normalized.length);
    } else if (phraseIndex > 0) {
        score += 780 - Math.min(180, phraseIndex * 5);
    }

    let nameWords = entry.nameWords || _searchWords(entry.displayName || '');
    let keywordWords = entry.keywordWords || _searchWords(entry.keywords || '');
    let descriptionWords = entry.descriptionWords ||
        _searchWords(entry.description || '');
    let idWords = entry.idWords || _searchWords(entry.desktopId || '');

    let compactMatched = false;
    if (query.compact.length >= 2) {
        let initials = entry.initials || _makeInitials(nameWords);
        let compactName = entry.compactName || nameWords.join('');

        if (initials === query.compact) {
            score += 880;
            compactMatched = true;
        } else if (initials.indexOf(query.compact) === 0) {
            score += 680;
            compactMatched = true;
        } else if (query.words.length > 1 &&
                   compactName.indexOf(query.compact) === 0) {
            score += 240;
            compactMatched = true;
        }
    }

    let tokenScore = 0;
    let allTokensInName = true;

    for (let i = 0; i < query.words.length; i++) {
        let token = query.words[i];
        let nameScore = _bestWordScore(nameWords, token, 138, 120, 84);
        let keywordScore = _bestWordScore(
            keywordWords,
            token,
            92,
            76,
            50
        );
        let idScore = _bestWordScore(idWords, token, 66, 52, 32);
        let descriptionScore = _bestWordScore(
            descriptionWords,
            token,
            48,
            38,
            22
        );
        let best = Math.max(
            nameScore,
            keywordScore,
            idScore,
            descriptionScore
        );

        if (best <= 0) {
            if (query.words.length === 1 && compactMatched)
                continue;
            return null;
        }

        if (nameScore <= 0)
            allTokensInName = false;
        tokenScore += best;
    }

    score += 180 + tokenScore;
    if (allTokensInName && query.words.length > 1)
        score += 120;

    // Running state is a deliberately small tie-breaker. Relevance always wins.
    if (_appIsRunning(entry))
        score += 34;

    return score;
}

// Bounded optimal-string-alignment distance. It handles a single adjacent
// transposition ("firefxo" -> "firefox") while abandoning rows that already
// exceed the allowed distance.
function _boundedDamerauLevenshtein(left, right, maxDistance) {
    if (left === right)
        return 0;
    if (!left || !right)
        return Math.max(left.length, right.length);
    if (Math.abs(left.length - right.length) > maxDistance)
        return maxDistance + 1;

    let previousPrevious = null;
    let previous = [];
    for (let j = 0; j <= right.length; j++)
        previous[j] = j;

    for (let i = 1; i <= left.length; i++) {
        let current = [i];
        let rowMinimum = current[0];

        for (let j = 1; j <= right.length; j++) {
            let substitutionCost = left.charAt(i - 1) === right.charAt(j - 1)
                ? 0
                : 1;
            let value = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + substitutionCost
            );

            if (previousPrevious && i > 1 && j > 1 &&
                left.charAt(i - 1) === right.charAt(j - 2) &&
                left.charAt(i - 2) === right.charAt(j - 1)) {
                value = Math.min(value, previousPrevious[j - 2] + 1);
            }

            current[j] = value;
            if (value < rowMinimum)
                rowMinimum = value;
        }

        if (rowMinimum > maxDistance)
            return maxDistance + 1;

        previousPrevious = previous;
        previous = current;
    }

    return previous[right.length];
}

function _scoreFuzzyAppEntry(entry, token, comparisonBudget) {
    let words = entry.nameWords || _searchWords(entry.displayName || '');
    let maxDistance = token.length >= 8 ? 2 : 1;
    let bestDistance = maxDistance + 1;
    let bestWordIndex = words.length;
    let bestLengthDelta = maxDistance + 1;

    for (let i = 0; i < words.length; i++) {
        if (comparisonBudget.count >= MAX_FUZZY_APP_COMPARISONS)
            break;

        let word = words[i];
        let lengthDelta = Math.abs(word.length - token.length);
        if (word.length < 3 || lengthDelta > maxDistance)
            continue;

        comparisonBudget.count++;
        let distance = _boundedDamerauLevenshtein(
            token,
            word,
            maxDistance
        );

        if (distance < bestDistance ||
            (distance === bestDistance && i < bestWordIndex) ||
            (distance === bestDistance && i === bestWordIndex &&
             lengthDelta < bestLengthDelta)) {
            bestDistance = distance;
            bestWordIndex = i;
            bestLengthDelta = lengthDelta;
        }

        // A perfect match in the first word cannot be improved.
        if (bestDistance === 0 && bestWordIndex === 0)
            break;
    }

    if (bestDistance > maxDistance)
        return null;

    // A typo in the first (or only) title word is usually a much stronger
    // signal than the same typo in a later generic word. This also keeps a
    // query such as "firefxo" focused on Firefox instead of a helper whose
    // title merely ends in "Firefox".
    let score = 360 - bestDistance * 90;
    score -= Math.min(72, bestWordIndex * 18);
    score -= Math.min(24, bestLengthDelta * 4);
    if (bestWordIndex === 0)
        score += 44;
    if (words.length === 1)
        score += 56;
    if (_appIsRunning(entry))
        score += 24;
    return score;
}

function findAppMatches(entries, value, limit) {
    let query = prepareAppSearchQuery(value);
    let maximum = Math.max(0, Math.floor(limit || 0));
    if (!Array.isArray(entries) || maximum === 0 || query.words.length === 0)
        return [];

    let scored = [];
    let directEntries = new Set();

    for (let i = 0; i < entries.length; i++) {
        let score = _scoreDirectAppEntry(entries[i], query);
        if (score === null)
            continue;

        scored.push({ entry: entries[i], score: score });
        directEntries.add(entries[i]);
    }

    scored.sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        return a.entry.displayName.localeCompare(b.entry.displayName);
    });

    // Typo tolerance is a fallback, never the primary algorithm. Even when the
    // grid asks for every match, fuzzy results are capped to a short launcher-
    // sized list so one misspelling cannot fill the screen with weak guesses.
    let fuzzyTarget = Math.min(maximum, 6);
    if (scored.length < fuzzyTarget &&
        query.words.length === 1 &&
        query.words[0].length >= 4 &&
        query.words[0].length <= 24) {
        let comparisonBudget = { count: 0 };
        let fuzzy = [];

        for (let i = 0; i < entries.length; i++) {
            if (directEntries.has(entries[i]) ||
                comparisonBudget.count >= MAX_FUZZY_APP_COMPARISONS)
                continue;

            let score = _scoreFuzzyAppEntry(
                entries[i],
                query.words[0],
                comparisonBudget
            );
            if (score !== null)
                fuzzy.push({ entry: entries[i], score: score });
        }

        fuzzy.sort((a, b) => {
            if (b.score !== a.score)
                return b.score - a.score;
            return a.entry.displayName.localeCompare(b.entry.displayName);
        });
        let fuzzySlots = Math.max(0, fuzzyTarget - scored.length);
        scored = scored.concat(fuzzy.slice(0, fuzzySlots));
    }

    return scored.slice(0, maximum).map(item => item.entry);
}

function _ensureCatalogInvalidation() {
    if (_catalogAppSystem)
        return _catalogAppSystem;

    _catalogAppSystem = Cinnamon.AppSystem.get_default();
    try {
        _catalogAppSystem.connect(
            'installed-changed',
            () => {
                _appCatalogCache = null;
            }
        );
    } catch (e) {}

    return _catalogAppSystem;
}

function _buildAppCatalog() {
    let entries = [];

    try {
        let appSystem = _ensureCatalogInvalidation();
        let CMenu = imports.gi.CMenu;
        let tree = appSystem.get_tree();
        let root = tree ? tree.get_root_directory() : null;
        let seenIds = new Set();

        let processDir = (dir) => {
            if (!dir)
                return;

            let iter = dir.iter();
            let nextType;

            while ((nextType = iter.next()) !== CMenu.TreeItemType.INVALID) {
                if (nextType === CMenu.TreeItemType.ENTRY) {
                    let entry = iter.get_entry();
                    let desktopId = entry
                        ? entry.get_desktop_file_id()
                        : null;
                    let app = desktopId
                        ? appSystem.lookup_app(desktopId)
                        : null;

                    if (!app || app.get_nodisplay() || seenIds.has(app.get_id()))
                        continue;

                    let displayName = _singleLine(app.get_name(), 160);
                    let description = '';
                    let keywords = '';
                    let appId = _singleLine(app.get_id(), 240);
                    try {
                        description = _singleLine(app.get_description(), 240);
                    } catch (e) {}
                    try {
                        if (typeof app.get_keywords === 'function')
                            keywords = _singleLine(app.get_keywords(), 320);
                    } catch (e) {}

                    let metadata = _buildAppSearchMetadata(
                        displayName,
                        description,
                        keywords,
                        appId
                    );
                    metadata.app = app;
                    entries.push(metadata);
                    seenIds.add(app.get_id());
                } else if (nextType === CMenu.TreeItemType.DIRECTORY) {
                    processDir(iter.get_directory());
                }
            }
        };

        processDir(root);
        entries.sort((a, b) =>
            a.displayName.localeCompare(b.displayName));
    } catch (e) {
        global.logError('AppGrid catalog: ' + e);
    }

    return entries;
}

function getAppCatalog() {
    if (!_appCatalogCache)
        _appCatalogCache = _buildAppCatalog();

    return _appCatalogCache.slice();
}

function getAppWindows(app) {
    if (!app || typeof app.get_windows !== 'function')
        return [];

    try {
        let windows = app.get_windows();
        return windows ? Array.from(windows) : [];
    } catch (e) {
        return [];
    }
}

function createAppIcon(app, size) {
    try {
        if (app && typeof app.create_icon_texture === 'function')
            return app.create_icon_texture(size);
    } catch (e) {}

    return new St.Icon({
        icon_name: 'application-x-executable-symbolic',
        icon_size: size,
        style: 'color: rgba(230,234,244,0.86);'
    });
}

function activateApp(app) {
    if (!app)
        return false;

    try {
        if (typeof app.activate_full === 'function')
            app.activate_full(-1, global.get_current_time());
        else if (typeof app.activate === 'function')
            app.activate();
        else if (typeof app.open_new_window === 'function')
            app.open_new_window(-1);
        else
            return false;

        if (Main.overview)
            Main.overview.hide();
        return true;
    } catch (e) {
        global.logError('AppGrid activate app: ' + e);
        return false;
    }
}

function openNewAppWindow(app) {
    if (!app || typeof app.open_new_window !== 'function')
        return false;

    try {
        app.open_new_window(-1);
        if (Main.overview)
            Main.overview.hide();
        return true;
    } catch (e) {
        global.logError('AppGrid open new window: ' + e);
        return false;
    }
}

function _createMenuItem(label, iconName) {
    if (iconName) {
        return new PopupMenu.PopupIconMenuItem(
            label,
            iconName,
            St.IconType.SYMBOLIC
        );
    }

    return new PopupMenu.PopupMenuItem(label);
}

function AppContextMenuController() {
    this._init();
}

AppContextMenuController.prototype = {
    _init: function() {
        this._menu = null;
        this._menuManager = null;
        this._menuOwner = null;
        this._sourceActor = null;
        this._sourceDestroyId = 0;
        this._destroyIdleId = 0;
        this._destroyed = false;
    },

    _addAction: function(menu, label, iconName, callback) {
        let item = _createMenuItem(label, iconName);
        item.connect('activate', () => {
            if (menu.isOpen)
                menu.close(false);

            try {
                callback();
            } catch (e) {
                global.logError('Overview app context action: ' + e);
            }
        });
        menu.addMenuItem(item);
        return item;
    },

    _addSeparator: function(menu) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    },

    _populate: function(menu, app) {
        let appName = _singleLine(app.get_name(), 72) || 'Aplicativo';
        let titleItem = new PopupMenu.PopupMenuItem(appName);
        titleItem.setSensitive(false);
        titleItem.actor.set_style('font-weight: bold;');
        menu.addMenuItem(titleItem);
        this._addSeparator(menu);

        this._addAction(
            menu,
            'Abrir',
            'xsi-media-playback-start',
            () => activateApp(app)
        );

        let canOpenNewWindow =
            typeof app.open_new_window === 'function';
        try {
            if (canOpenNewWindow &&
                typeof app.can_open_new_window === 'function') {
                canOpenNewWindow = app.can_open_new_window();
            }
        } catch (e) {}

        if (canOpenNewWindow) {
            this._addAction(
                menu,
                'Abrir nova janela',
                'xsi-list-add',
                () => openNewAppWindow(app)
            );
        }

        let windows = getAppWindows(app);
        if (windows.length > 0) {
            this._addSeparator(menu);

            if (windows.length === 1) {
                this._addAction(
                    menu,
                    'Mostrar janela aberta',
                    _getWindowFocusIconName(),
                    () => Main.activateWindow(
                        windows[0],
                        global.get_current_time()
                    )
                );
            } else {
                let windowsSubmenu = new PopupMenu.PopupSubMenuMenuItem(
                    'Janelas abertas (' + windows.length + ')'
                );
                _addLeadingMenuIcon(
                    windowsSubmenu,
                    _getWindowFocusIconName()
                );
                menu.addMenuItem(windowsSubmenu);

                let count = Math.min(windows.length, MAX_CONTEXT_WINDOWS);
                for (let i = 0; i < count; i++) {
                    let window = windows[i];
                    let rawTitle = '';
                    try {
                        if (window && window.get_title)
                            rawTitle = window.get_title();
                    } catch (e) {}
                    let title = _singleLine(rawTitle, 72) ||
                                ('Janela ' + (i + 1));
                    let item = _createMenuItem(
                        title,
                        _getWindowFocusIconName()
                    );
                    item.connect('activate', () => {
                        if (menu.isOpen)
                            menu.close(false);
                        Main.activateWindow(
                            window,
                            global.get_current_time()
                        );
                    });
                    windowsSubmenu.menu.addMenuItem(item);
                }

                if (windows.length > count) {
                    let remaining = new PopupMenu.PopupMenuItem(
                        '+ ' + (windows.length - count) + ' outras janelas'
                    );
                    remaining.setSensitive(false);
                    windowsSubmenu.menu.addMenuItem(remaining);
                }
            }
        }

        let appInfo = null;
        let actions = [];
        try {
            appInfo = typeof app.get_app_info === 'function'
                ? app.get_app_info()
                : null;
            actions = appInfo && typeof appInfo.list_actions === 'function'
                ? Array.from(appInfo.list_actions() || [])
                : [];
        } catch (e) {
            actions = [];
        }

        if (appInfo && actions.length > 0) {
            this._addSeparator(menu);
            for (let i = 0; i < actions.length; i++) {
                let action = actions[i];
                let rawActionLabel = action;
                try {
                    rawActionLabel = appInfo.get_action_name(action);
                } catch (e) {}
                let actionLabel = _singleLine(rawActionLabel, 72) || action;
                let actionIcon = null;
                try {
                    if (typeof Util.getDesktopActionIcon === 'function')
                        actionIcon = Util.getDesktopActionIcon(action);
                } catch (e) {}

                this._addAction(
                    menu,
                    actionLabel,
                    actionIcon || 'xsi-media-playback-start',
                    () => {
                        appInfo.launch_action(
                            action,
                            global.create_app_launch_context()
                        );
                        if (Main.overview)
                            Main.overview.hide();
                    }
                );
            }
        }

        if (Main.gpu_offload_supported &&
            typeof app.launch_offloaded === 'function') {
            this._addSeparator(menu);
            this._addAction(
                menu,
                'Executar com GPU dedicada',
                'xsi-cpu',
                () => {
                    app.launch_offloaded(0, [], -1);
                    if (Main.overview)
                        Main.overview.hide();
                }
            );
        }

        if (windows.length > 0 && typeof app.request_quit === 'function') {
            this._addSeparator(menu);
            this._addAction(
                menu,
                windows.length > 1
                    ? 'Fechar todas as janelas'
                    : 'Fechar janela',
                'xsi-exit',
                () => app.request_quit()
            );
        }
    },

    open: function(app, sourceActor) {
        if (this._destroyed || !app || !sourceActor)
            return false;

        this.close(false);
        this._destroyCurrentMenu();

        let menu = new PopupMenu.PopupMenu(sourceActor, St.Side.TOP);
        menu.setCustomStyleClass('overview-app-context-menu');
        menu.actor.set_style('min-width: 270px;');
        Main.uiGroup.add_actor(menu.actor);
        menu.actor.hide();

        // The popup owns a separate modal actor. Reusing the Overview's modal
        // owner would put the same actor on Main's modal stack twice.
        let owner = { actor: menu.actor };
        let manager = new PopupMenu.PopupMenuManager(owner);
        manager.addMenu(menu);

        this._menu = menu;
        this._menuManager = manager;
        this._menuOwner = owner;
        this._sourceActor = sourceActor;

        this._sourceDestroyId = sourceActor.connect('destroy', () => {
            if (this._menu === menu) {
                if (menu.isOpen)
                    menu.close(false);
                this._destroyCurrentMenu();
            }
        });

        menu.connect('open-state-changed', (currentMenu, isOpen) => {
            if (!isOpen && this._menu === currentMenu)
                this._scheduleDestroyCurrentMenu();
        });

        this._populate(menu, app);
        menu.open(true);

        Mainloop.idle_add(() => {
            if (this._menu === menu && menu.isOpen) {
                try {
                    menu.actor.navigate_focus(
                        null,
                        Gtk.DirectionType.DOWN,
                        false
                    );
                } catch (e) {}
            }
            return false;
        });

        return true;
    },

    _scheduleDestroyCurrentMenu: function() {
        if (this._destroyIdleId)
            return;

        this._destroyIdleId = Mainloop.idle_add(() => {
            this._destroyIdleId = 0;
            if (this._menu && !this._menu.isOpen)
                this._destroyCurrentMenu();
            return false;
        });
    },

    _destroyCurrentMenu: function() {
        if (this._destroyIdleId) {
            Mainloop.source_remove(this._destroyIdleId);
            this._destroyIdleId = 0;
        }

        let menu = this._menu;
        let sourceActor = this._sourceActor;
        let sourceDestroyId = this._sourceDestroyId;

        this._menu = null;
        this._menuManager = null;
        this._menuOwner = null;
        this._sourceActor = null;
        this._sourceDestroyId = 0;

        if (sourceActor && sourceDestroyId) {
            try {
                sourceActor.disconnect(sourceDestroyId);
            } catch (e) {}
        }

        if (menu) {
            try {
                menu.destroy();
            } catch (e) {}
        }
    },

    close: function(animate) {
        if (!this._menu)
            return;

        if (this._menu.isOpen) {
            this._menu.close(animate !== false);
            if (animate === false)
                this._destroyCurrentMenu();
        } else {
            this._destroyCurrentMenu();
        }
    },

    isOpen: function() {
        return !!(this._menu && this._menu.isOpen);
    },

    destroy: function() {
        this._destroyed = true;
        this.close(false);
        this._destroyCurrentMenu();
    }
};

function AppGrid(onNavigateToSearch) {
    this._init(onNavigateToSearch);
}

AppGrid.prototype = {
    _init: function(onNavigateToSearch) {
        this.actor = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true
        });

        this._scrollView = new St.ScrollView({
            x_fill: true,
            y_fill: true,
            x_expand: true,
            y_expand: true,
            style_class: 'vfade'
        });
        this._scrollView.set_policy(
            Gtk.PolicyType.NEVER,
            Gtk.PolicyType.AUTOMATIC
        );
        this.actor.add_actor(this._scrollView);

        this._rowsBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: false,
            style: 'padding: ' + TOP_PAD + 'px ' + SIDE_PAD +
                   'px 64px ' + SIDE_PAD + 'px;' +
                   'spacing: ' + ROW_GAP + 'px;'
        });
        this._scrollView.add_actor(this._rowsBox);

        this._allApps = [];
        this._buttons = [];
        this._query = '';
        this._ncols = 0;
        this._rowsBuilt = false;
        this._layoutDirty = true;
        this._destroyed = false;
        this._focusScrollIdleId = 0;
        this._onNavigateToSearch = typeof onNavigateToSearch === 'function'
            ? onNavigateToSearch
            : null;
        this._contextMenu = new AppContextMenuController();

        this._appSystem = _ensureCatalogInvalidation();
        this._installedChangedId = 0;
        try {
            this._installedChangedId = this._appSystem.connect(
                'installed-changed',
                () => {
                    // Explicitly invalidate here as well as in the module-level
                    // listener so the refresh is independent of signal order.
                    _appCatalogCache = null;
                    if (!this._destroyed)
                        this._loadApps(true);
                }
            );
        } catch (e) {}

        this._loadApps(false);
    },

    setAvailWidth: function(width) {
        let available = Math.max(0, width - SIDE_PAD * 2);
        let stride = CELL_WIDTH + CELL_GAP;
        let columns = Math.floor((available + CELL_GAP) / stride);
        columns = Math.min(MAX_COLS, Math.max(MIN_COLS, columns));

        if (columns === this._ncols)
            return;

        this._ncols = columns;
        this._layoutDirty = true;

        // Do not create every icon while the user is opening Workspaces. Once
        // the grid has been shown at least once, a resize can rebuild it now.
        if (this._rowsBuilt)
            this._rebuildGrid();
    },

    prepare: function() {
        if (this._destroyed)
            return false;

        if (!this._rowsBuilt || this._layoutDirty)
            this._rebuildGrid();

        return this._buttons.length > 0;
    },

    getApps: function() {
        return this._allApps.slice();
    },

    _loadApps: function(rebuildIfVisible) {
        let hadRows = this._rowsBuilt;
        this._allApps = getAppCatalog();
        this._rowsBuilt = false;
        this._layoutDirty = true;

        if (this._ncols > 0 &&
            (rebuildIfVisible || hadRows) &&
            this.actor && this.actor.visible) {
            this._rebuildGrid();
        }
    },

    _destroyRows: function() {
        this.closeContextMenu(false);
        this._buttons = [];
        let child = this._rowsBox.get_first_child();

        while (child) {
            let next = child.get_next_sibling();
            this._rowsBox.remove_actor(child);
            child.destroy();
            child = next;
        }
    },

    _rebuildGrid: function() {
        if (this._destroyed || this._ncols <= 0)
            return;

        this._destroyRows();
        this._rowsBuilt = true;
        this._layoutDirty = false;

        let filtered = this._query === ''
            ? this._allApps
            : findAppMatches(
                this._allApps,
                this._query,
                this._allApps.length
            );

        if (filtered.length === 0) {
            let emptyState = new St.BoxLayout({
                vertical: true,
                x_align: Clutter.ActorAlign.CENTER,
                style: 'padding: 48px; spacing: 10px;'
            });
            emptyState.add_actor(new St.Icon({
                icon_name: 'edit-find-symbolic',
                icon_size: 34,
                style: 'color: rgba(224,228,239,0.48);'
            }));
            emptyState.add_actor(new St.Label({
                text: 'Nenhum aplicativo encontrado',
                x_align: Clutter.ActorAlign.CENTER,
                style: 'color: rgba(235,238,246,0.68); font-size: 13px;'
            }));
            this._rowsBox.add_actor(emptyState);
            this._scrollToTop();
            return;
        }

        let row = null;
        let columns = this._ncols || MIN_COLS;

        for (let i = 0; i < filtered.length; i++) {
            if (i % columns === 0) {
                row = new St.BoxLayout({
                    x_align: Clutter.ActorAlign.CENTER,
                    x_expand: true,
                    style: 'spacing: ' + CELL_GAP + 'px;'
                });
                this._rowsBox.add_actor(row);
            }

            let button = this._makeButton(filtered[i]);
            button._overviewGridIndex = this._buttons.length;
            this._buttons.push(button);
            row.add_actor(button);
        }

        this._scrollToTop();
    },

    _scrollToTop: function() {
        try {
            let adjustment = this._scrollView
                .get_vscroll_bar()
                .get_adjustment();
            if (adjustment)
                adjustment.value = 0;
        } catch (e) {
            // Some Cinnamon/St versions create the scrollbar lazily.
        }
    },

    _makeButton: function(entry) {
        let app = entry.app;
        let icon = createAppIcon(app, ICON_SIZE);
        let labelWidth = CELL_WIDTH - CELL_PAD * 2;

        let label = new St.Label({
            text: entry.displayName || _singleLine(app.get_name(), 80),
            x_align: Clutter.ActorAlign.CENTER,
            style: 'color: rgba(247,248,252,0.94); font-size: 11px;' +
                   'font-weight: bold; text-align: center;'
        });
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        label.clutter_text.set_line_wrap(false);
        label.set_width(labelWidth);

        let box = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 9px; padding: ' + CELL_PAD + 'px;'
        });
        box.add_actor(icon);
        box.add_actor(label);

        let button = new St.Button({
            reactive: true,
            can_focus: true,
            track_hover: true,
            style_class: 'overview-app-button',
            style: APP_BUTTON_NORMAL_STYLE
        });
        button.set_width(CELL_WIDTH);
        button.set_child(box);
        button._overviewApp = app;

        try {
            button.set_pivot_point(0.5, 0.5);
        } catch (e) {}

        let hovered = false;
        let focused = false;
        let updateState = () => {
            let active = hovered || focused;
            button.set_style(
                active
                    ? APP_BUTTON_ACTIVE_STYLE
                    : APP_BUTTON_NORMAL_STYLE
            );
            button.remove_all_transitions();
            button.ease({
                scale_x: active ? 1.045 : 1.0,
                scale_y: active ? 1.045 : 1.0,
                duration: active ? 120 : 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
        };

        let activate = () => activateApp(app);
        button._overviewActivate = activate;
        button.connect('clicked', activate);
        button.connect('button-press-event', (actor, event) => {
            let mouseButton = event.get_button();
            if (mouseButton === 3) {
                this.openAppContextMenu(app, button);
                return true;
            }
            if (mouseButton === 2) {
                openNewAppWindow(app);
                return true;
            }
            return false;
        });
        button.connect('enter-event', () => {
            hovered = true;
            updateState();
        });
        button.connect('leave-event', () => {
            hovered = false;
            updateState();
        });
        button.connect('key-focus-in', () => {
            focused = true;
            updateState();
        });
        button.connect('key-focus-out', () => {
            focused = false;
            updateState();
        });
        button.connect('key-press-event', (actor, event) =>
            this._onButtonKeyPress(actor, event));

        return button;
    },

    openAppContextMenu: function(app, sourceActor) {
        return this._contextMenu.open(app, sourceActor);
    },

    closeContextMenu: function(animate) {
        if (this._contextMenu)
            this._contextMenu.close(animate);
    },

    isContextMenuOpen: function() {
        return !!(this._contextMenu && this._contextMenu.isOpen());
    },

    focusFirst: function() {
        this.prepare();
        return this._focusButtonAt(0);
    },

    focusLast: function() {
        this.prepare();
        return this._focusButtonAt(this._buttons.length - 1);
    },

    _focusButtonAt: function(index) {
        if (index < 0 || index >= this._buttons.length)
            return false;

        let button = this._buttons[index];
        if (!button)
            return false;

        try {
            button.grab_key_focus();
        } catch (e) {
            global.stage.set_key_focus(button);
        }

        if (this._focusScrollIdleId)
            Mainloop.source_remove(this._focusScrollIdleId);

        this._focusScrollIdleId = Mainloop.idle_add(() => {
            this._focusScrollIdleId = 0;
            if (!this._destroyed)
                this._ensureButtonVisible(button);
            return false;
        });
        return true;
    },

    _focusSearchEntry: function() {
        if (this._onNavigateToSearch)
            this._onNavigateToSearch();
    },

    _onButtonKeyPress: function(button, event) {
        let index = button._overviewGridIndex;
        if (typeof index !== 'number' || index < 0)
            return false;

        let symbol = event.get_key_symbol();
        let modifiers = Cinnamon.get_event_state(event);
        let openContextMenu = symbol === Clutter.KEY_Menu ||
            (symbol === Clutter.KEY_F10 &&
             (modifiers & Clutter.ModifierType.SHIFT_MASK));

        if (openContextMenu) {
            this.openAppContextMenu(button._overviewApp, button);
            return true;
        }

        let columns = Math.max(1, this._ncols || 1);
        let target = index;

        switch (symbol) {
            case Clutter.KEY_Return:
            case Clutter.KEY_KP_Enter:
            case Clutter.KEY_space:
                if (button._overviewActivate)
                    button._overviewActivate();
                return true;
            case Clutter.KEY_Left:
            case Clutter.KEY_KP_Left:
                target = index - 1;
                break;
            case Clutter.KEY_Right:
            case Clutter.KEY_KP_Right:
                target = index + 1;
                break;
            case Clutter.KEY_Up:
            case Clutter.KEY_KP_Up:
                if (index < columns) {
                    this._focusSearchEntry();
                    return true;
                }
                target = index - columns;
                break;
            case Clutter.KEY_Down:
            case Clutter.KEY_KP_Down: {
                let nextRowStart = (Math.floor(index / columns) + 1) * columns;
                if (nextRowStart >= this._buttons.length) {
                    // Keep vertical navigation symmetric with the search bar:
                    // Down enters at the first app and Down from the final row
                    // returns to the bar; Up performs the reverse cycle.
                    this._focusSearchEntry();
                    return true;
                }
                target = Math.min(
                    nextRowStart + (index % columns),
                    this._buttons.length - 1
                );
                break;
            }
            case Clutter.KEY_Home:
            case Clutter.KEY_KP_Home:
                target = 0;
                break;
            case Clutter.KEY_End:
            case Clutter.KEY_KP_End:
                target = this._buttons.length - 1;
                break;
            case Clutter.KEY_Page_Up:
            case Clutter.KEY_KP_Page_Up:
                target = Math.max(0, index - columns * 3);
                break;
            case Clutter.KEY_Page_Down:
            case Clutter.KEY_KP_Page_Down:
                target = Math.min(
                    this._buttons.length - 1,
                    index + columns * 3
                );
                break;
            default:
                return false;
        }

        if (target < 0 || target >= this._buttons.length)
            return true;

        this._focusButtonAt(target);
        return true;
    },

    _ensureButtonVisible: function(button) {
        try {
            let adjustment = this._scrollView
                .get_vscroll_bar()
                .get_adjustment();
            if (!adjustment)
                return;

            let [, buttonY] = button.get_transformed_position();
            let [, viewY] = this._scrollView.get_transformed_position();
            let [, buttonHeight] = button.get_transformed_size();
            let relativeTop = buttonY - viewY;
            let relativeBottom = relativeTop + buttonHeight;
            let pageSize = adjustment.page_size || this._scrollView.height;
            let margin = 14;
            let target = adjustment.value;

            if (relativeTop < margin)
                target += relativeTop - margin;
            else if (relativeBottom > pageSize - margin)
                target += relativeBottom - pageSize + margin;

            let maximum = Math.max(
                adjustment.lower,
                adjustment.upper - adjustment.page_size
            );
            adjustment.value = Math.max(
                adjustment.lower,
                Math.min(maximum, target)
            );
        } catch (e) {
            // Allocation and scrollbars can still be settling after a rebuild.
        }
    },

    filterApps: function(query) {
        let normalized = _singleLine(query, 256);
        if (normalized === this._query)
            return;

        this._query = normalized;
        this._layoutDirty = true;
        this.prepare();
    },

    reset: function() {
        if (this._query === '') {
            if (this._rowsBuilt)
                this._scrollToTop();
            return;
        }

        this._query = '';
        this._layoutDirty = true;
        if (this._rowsBuilt)
            this._rebuildGrid();
    },

    destroy: function() {
        this._destroyed = true;

        if (this._focusScrollIdleId) {
            Mainloop.source_remove(this._focusScrollIdleId);
            this._focusScrollIdleId = 0;
        }

        if (this._appSystem && this._installedChangedId) {
            try {
                this._appSystem.disconnect(this._installedChangedId);
            } catch (e) {}
        }
        this._installedChangedId = 0;
        this._appSystem = null;

        if (this._contextMenu) {
            this._contextMenu.destroy();
            this._contextMenu = null;
        }

        this._allApps = [];
        this._buttons = [];
        this._onNavigateToSearch = null;
        this.actor.destroy();
        this.actor = null;
    }
};
