// searchResults.js - Search results panel for the Cinnamon Overview.
// File discovery uses cancellable asynchronous Gio enumeration, so it never
// blocks Cinnamon's main/UI thread.

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Cinnamon = imports.gi.Cinnamon;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;
const Util = imports.misc.util;
const AppGrid = imports.ui.appGrid;

const MAX_APP_RESULTS = 6;
const MAX_FILE_RESULTS = 5;
const FILE_SEARCH_DELAY_MS = 240;
const FILE_SEARCH_BATCH_SIZE = 48;
const FILE_SEARCH_MAX_DEPTH = 5;
const FILE_SEARCH_MAX_DIRECTORIES = 800;
const FILE_SEARCH_MAX_TIME_MS = 420;
const FILE_SEARCH_MAX_CANDIDATES = 36;
const MAX_SEARCH_QUERY_LENGTH = 512;
const MAX_MATH_EXPRESSION_LENGTH = 128;
const HOME_DIR = GLib.get_home_dir();

function _normalize(text) {
    let value = String(text || '').toLocaleLowerCase();

    try {
        return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {
        return value;
    }
}

function _singleLine(value, maxLength) {
    let text = String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (maxLength > 0 && text.length > maxLength)
        text = text.slice(0, Math.max(1, maxLength - 1)) + '…';

    return text;
}

function _sanitizeQuery(value) {
    return _singleLine(value, MAX_SEARCH_QUERY_LENGTH);
}


function _normalizeSearchPhrase(value) {
    return _normalize(value)
        .replace(/[._\-\/:;,()\[\]{}]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function _searchWords(value) {
    let normalized = _normalizeSearchPhrase(value);
    return normalized ? normalized.split(' ').filter(word => word.length > 0) : [];
}

function _prepareFileSearchQuery(value) {
    let normalized = _normalizeSearchPhrase(_singleLine(value, 256));
    let words = normalized
        ? normalized.split(' ').filter(word => word.length > 0)
        : [];

    return {
        normalized: normalized,
        words: words,
        compactLength: words.join('').length
    };
}

function _bestFileWordScore(words, token) {
    let best = 0;
    for (let i = 0; i < words.length; i++) {
        let word = words[i];
        let score = 0;
        if (word === token)
            score = 112;
        else if (word.indexOf(token) === 0)
            score = 94;
        else if (word.indexOf(token) !== -1)
            score = 62;

        if (score > 0)
            score -= Math.min(10, i * 2);
        if (score > best)
            best = score;
    }
    return best;
}

function _scoreFileName(name, queryInfo) {
    if (!queryInfo || queryInfo.words.length === 0)
        return null;

    let displayName = _singleLine(name, 320);
    let normalizedName = _normalizeSearchPhrase(displayName);
    if (!normalizedName)
        return null;

    let lastDot = displayName.lastIndexOf('.');
    let stem = lastDot > 0
        ? _normalizeSearchPhrase(displayName.slice(0, lastDot))
        : normalizedName;
    let words = _searchWords(displayName);
    let score = 0;
    let phraseIndex = normalizedName.indexOf(queryInfo.normalized);
    let stemIndex = stem.indexOf(queryInfo.normalized);
    let containsIndex = -1;
    if (phraseIndex > 0)
        containsIndex = phraseIndex;
    if (stemIndex > 0 &&
        (containsIndex < 0 || stemIndex < containsIndex))
        containsIndex = stemIndex;

    if (normalizedName === queryInfo.normalized)
        score += 1260;
    else if (stem === queryInfo.normalized)
        score += 1230;
    else if (phraseIndex === 0 || stemIndex === 0)
        score += 1020;
    else if (containsIndex > 0)
        score += 760 - Math.min(160, containsIndex * 4);

    let tokenScore = 0;
    for (let i = 0; i < queryInfo.words.length; i++) {
        let best = _bestFileWordScore(words, queryInfo.words[i]);
        if (best <= 0)
            return null;
        tokenScore += best;
    }

    score += 160 + tokenScore;
    if (queryInfo.words.length > 1)
        score += 70;
    return score;
}

function _getFileSearchLimits(queryInfo) {
    if (queryInfo.compactLength <= 2) {
        return {
            maxDepth: 2,
            maxDirectories: 120,
            maxTimeMs: 160,
            maxCandidates: 18
        };
    }

    if (queryInfo.compactLength <= 4) {
        return {
            maxDepth: 4,
            maxDirectories: 420,
            maxTimeMs: 280,
            maxCandidates: 28
        };
    }

    return {
        maxDepth: FILE_SEARCH_MAX_DEPTH,
        maxDirectories: FILE_SEARCH_MAX_DIRECTORIES,
        maxTimeMs: FILE_SEARCH_MAX_TIME_MS,
        maxCandidates: FILE_SEARCH_MAX_CANDIDATES
    };
}

function _scoreFileCandidate(name, queryInfo, options) {
    let score = _scoreFileName(name, queryInfo);
    if (score === null)
        return null;

    options = options || {};
    score += Math.max(0, Number(options.priorityBonus || 0));
    score -= Math.max(0, Number(options.depth || 0)) * 4;

    if (options.recentRank !== undefined)
        score += Math.max(34, 126 - Number(options.recentRank) * 6);

    let modifiedSeconds = Number(options.modifiedSeconds || 0);
    if (modifiedSeconds > 0) {
        let nowSeconds = Date.now() / 1000;
        let ageDays = Math.max(0, (nowSeconds - modifiedSeconds) / 86400);
        if (ageDays <= 7)
            score += 28;
        else if (ageDays <= 30)
            score += 18;
        else if (ageDays <= 365)
            score += 7;
    }

    return score;
}

function _compareFileCandidates(left, right) {
    if (right.score !== left.score)
        return right.score - left.score;
    if (!!right.recent !== !!left.recent)
        return right.recent ? 1 : -1;
    return left.name.localeCompare(right.name);
}

function _looksLikeExplicitUri(value) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value || '').trim());
}

function _prepareCalculatorExpression(value) {
    return _singleLine(value, MAX_MATH_EXPRESSION_LENGTH)
        .replace(/[−–—]/g, '-')
        .replace(/×/g, '*')
        .replace(/÷/g, '/');
}

function _normalizeMathExpression(value) {
    return _prepareCalculatorExpression(value)
        .replace(/,/g, '.')
        .replace(/\s+/g, '');
}

function _isMathExpression(value) {
    let normalized = _normalizeMathExpression(value);
    return normalized.length >= 3 &&
           normalized.length <= MAX_MATH_EXPRESSION_LENGTH &&
           /^[\d\+\-\*\/\^\(\)\.]+$/.test(normalized) &&
           /[\+\-\*\/\^]/.test(normalized);
}

// Small recursive-descent parser. It deliberately supports only arithmetic
// tokens, avoids dynamic evaluation, preserves conventional precedence, and
// makes exponentiation right-associative (2^3^2 == 2^(3^2)).
function _evaluateMathExpression(value) {
    let input = _normalizeMathExpression(value);
    if (!_isMathExpression(input))
        return null;

    let position = 0;

    let finiteOrNull = (number) =>
        typeof number === 'number' && isFinite(number) ? number : null;

    let parsePrimary = null;
    let parsePower = null;
    let parseUnary = null;
    let parseMultiplyDivide = null;
    let parseAddSubtract = null;

    parsePrimary = () => {
        if (input.charAt(position) === '(') {
            position++;
            let inner = parseAddSubtract();
            if (inner === null || input.charAt(position) !== ')')
                return null;
            position++;
            return inner;
        }

        let start = position;
        let hasDigit = false;

        while (/\d/.test(input.charAt(position))) {
            hasDigit = true;
            position++;
        }

        if (input.charAt(position) === '.') {
            position++;
            while (/\d/.test(input.charAt(position))) {
                hasDigit = true;
                position++;
            }
        }

        if (!hasDigit)
            return null;

        return finiteOrNull(Number(input.slice(start, position)));
    };

    parsePower = () => {
        let left = parsePrimary();
        if (left === null)
            return null;

        if (input.charAt(position) === '^') {
            position++;
            let right = parseUnary();
            if (right === null)
                return null;
            return finiteOrNull(Math.pow(left, right));
        }

        return left;
    };

    parseUnary = () => {
        let token = input.charAt(position);
        if (token === '+' || token === '-') {
            position++;
            let valueAfterSign = parseUnary();
            if (valueAfterSign === null)
                return null;
            return token === '-' ? -valueAfterSign : valueAfterSign;
        }

        return parsePower();
    };

    parseMultiplyDivide = () => {
        let value = parseUnary();
        if (value === null)
            return null;

        while (position < input.length) {
            let operator = input.charAt(position);
            if (operator !== '*' && operator !== '/')
                break;

            position++;
            let right = parseUnary();
            if (right === null || (operator === '/' && right === 0))
                return null;

            value = operator === '*'
                ? finiteOrNull(value * right)
                : finiteOrNull(value / right);
            if (value === null)
                return null;
        }

        return value;
    };

    parseAddSubtract = () => {
        let value = parseMultiplyDivide();
        if (value === null)
            return null;

        while (position < input.length) {
            let operator = input.charAt(position);
            if (operator !== '+' && operator !== '-')
                break;

            position++;
            let right = parseMultiplyDivide();
            if (right === null)
                return null;

            value = operator === '+'
                ? finiteOrNull(value + right)
                : finiteOrNull(value - right);
            if (value === null)
                return null;
        }

        return value;
    };

    let result = parseAddSubtract();
    if (result === null || position !== input.length)
        return null;

    result = Math.round(result * 1e10) / 1e10;
    if (Math.abs(result) < 1e-12)
        result = 0;

    return finiteOrNull(result);
}

function SearchResults(appEntries, onNavigateToSearch, onOpenAppContextMenu) {
    this._init(
        appEntries,
        onNavigateToSearch,
        onOpenAppContextMenu
    );
}

SearchResults.prototype = {
    _init: function(appEntries, onNavigateToSearch, onOpenAppContextMenu) {
        // Shared visual tokens. The cool blue accent sits between GNOME's
        // Adwaita blue, Zorin's launcher and ChromeOS' Material palette.
        this._accent = '#78aeed';
        this._accentSoft = 'rgba(120,174,237,0.14)';
        this._accentHover = 'rgba(120,174,237,0.22)';
        this._cardBg = 'rgba(18,21,31,0.945)';
        this._cardBorder = 'rgba(255,255,255,0.115)';
        this._cardShadow =
            '0 22px 64px rgba(0,0,0,0.54), 0 6px 18px rgba(0,0,0,0.30)';
        this._textPri = 'rgba(247,248,252,0.97)';
        this._textSec = 'rgba(190,195,209,0.72)';
        this._rowHoverBg = 'rgba(255,255,255,0.075)';
        this._sepColor = 'rgba(255,255,255,0.065)';

        this.actor = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true
        });

        this._card = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true
        });
        this._card.set_style(
            'background-color: ' + this._cardBg + ';' +
            'border-radius: 22px;' +
            'border: 1px solid ' + this._cardBorder + ';' +
            'box-shadow: ' + this._cardShadow + ';'
        );
        try {
            this._card.clip_to_allocation = true;
        } catch (e) {
            // Not available on every St version.
        }
        this.actor.add_actor(this._card);

        this._scrollView = new St.ScrollView({
            x_fill: true,
            y_fill: true,
            x_expand: true,
            y_expand: true,
            style: 'background: transparent;'
        });
        let Gtk = imports.gi.Gtk;
        this._scrollView.set_policy(
            Gtk.PolicyType.NEVER,
            Gtk.PolicyType.AUTOMATIC
        );
        this._card.add_actor(this._scrollView);

        this._content = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 10px 0 16px 0;'
        });
        this._scrollView.add_actor(this._content);

        this._fileSearchTimeoutId = 0;
        this._fileSearchCancellable = null;
        this._fileSearchGeneration = 0;
        this._lastQuery = '';
        this._firstSection = true;
        this._destroyed = false;
        this._resultButtons = [];
        this._availableWidth = 0;
        this._focusScrollIdleId = 0;
        this._onNavigateToSearch = typeof onNavigateToSearch === 'function'
            ? onNavigateToSearch
            : null;
        this._onOpenAppContextMenu =
            typeof onOpenAppContextMenu === 'function'
                ? onOpenAppContextMenu
                : null;

        this._allApps = Array.isArray(appEntries)
            ? appEntries.slice()
            : [];

        // Fallback for callers outside overview.js. The normal overview path
        // shares AppGrid's catalog and therefore avoids traversing CMenu twice.
        if (this._allApps.length === 0)
            this._loadApps();
    },

    search: function(query) {
        let sanitizedQuery = _sanitizeQuery(query);
        if (sanitizedQuery === this._lastQuery && sanitizedQuery)
            return;

        this._cancelFileSearch();
        this._lastQuery = sanitizedQuery;
        this._clearContent();

        if (!this._lastQuery) {
            this.actor.hide();
            return;
        }

        this.actor.show();
        this._firstSection = true;
        let hasCalculatorResult = this._buildCalcSection(this._lastQuery);
        this._buildAppsSection(this._lastQuery);
        this._buildWebSection(this._lastQuery);

        // Arithmetic and explicit URIs already have deterministic answers.
        // A one-character file search is intentionally avoided because it is
        // broad, noisy and needlessly expensive.
        let fileQueryInfo = _prepareFileSearchQuery(this._lastQuery);
        if (hasCalculatorResult ||
            _looksLikeExplicitUri(this._lastQuery) ||
            fileQueryInfo.compactLength < 2)
            return;

        let currentQuery = this._lastQuery;
        let generation = this._fileSearchGeneration;

        this._fileSearchTimeoutId = Mainloop.timeout_add(
            FILE_SEARCH_DELAY_MS,
            () => {
                this._fileSearchTimeoutId = 0;

                if (!this._destroyed &&
                    this._lastQuery === currentQuery &&
                    this._fileSearchGeneration === generation) {
                    this._startFileSearch(currentQuery, generation);
                }

                return false;
            }
        );
    },

    setAvailableWidth: function(width) {
        this._availableWidth = Math.max(0, Math.floor(width || 0));
    },

    clear: function() {
        this._cancelFileSearch();
        this._clearContent();
        this.actor.hide();
        this._lastQuery = '';
    },

    destroy: function() {
        this._destroyed = true;
        this._cancelFileSearch();
        this._cancelFocusScroll();
        this._allApps = [];
        this._resultButtons = [];
        this._onNavigateToSearch = null;
        this._onOpenAppContextMenu = null;
        this.actor.destroy();
        this.actor = null;
    },

    _cancelFocusScroll: function() {
        if (!this._focusScrollIdleId)
            return;

        Mainloop.source_remove(this._focusScrollIdleId);
        this._focusScrollIdleId = 0;
    },

    _cancelFileSearch: function() {
        if (this._fileSearchTimeoutId) {
            Mainloop.source_remove(this._fileSearchTimeoutId);
            this._fileSearchTimeoutId = 0;
        }

        if (this._fileSearchCancellable) {
            this._fileSearchCancellable.cancel();
            this._fileSearchCancellable = null;
        }

        this._fileSearchGeneration++;
    },

    _isCurrentFileSearch: function(generation, cancellable) {
        return !this._destroyed &&
               generation === this._fileSearchGeneration &&
               this._fileSearchCancellable === cancellable &&
               !cancellable.is_cancelled();
    },

    _clearContent: function() {
        this._cancelFocusScroll();
        this._resultButtons = [];
        let child = this._content.get_first_child();

        while (child) {
            let next = child.get_next_sibling();
            this._content.remove_actor(child);
            child.destroy();
            child = next;
        }

        this._firstSection = true;
    },

    _addSection: function(title) {
        if (!this._firstSection) {
            let separator = new St.Widget({
                x_expand: true,
                style: 'background-color: ' + this._sepColor + ';' +
                       'height: 1px; margin: 14px 24px 4px 24px;'
            });
            this._content.add_actor(separator);
        }
        this._firstSection = false;

        // A Bin gives the heading the complete horizontal allocation. Some
        // Cinnamon themes otherwise collapse a bare label to a few pixels and
        // render headings such as "Web" as "W...".
        let header = new St.Bin({
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style: 'padding: 14px 26px 6px 26px;'
        });
        let headingMinWidth = this._availableWidth > 0
            ? Math.max(120, Math.min(220, this._availableWidth - 52))
            : 220;
        let label = new St.Label({
            text: title,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            style: 'color: ' + this._textSec + '; font-size: 12px;' +
                   'font-weight: bold; letter-spacing: 0.9px;' +
                   'min-width: ' + headingMinWidth + 'px;'
        });
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        label.clutter_text.set_line_wrap(false);
        label.set_width(headingMinWidth);
        try {
            label.clutter_text.set_single_line_mode(true);
        } catch (e) {}
        header.set_child(label);
        this._content.add_actor(header);

        let rows = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 2px 10px 8px 10px;'
        });
        this._content.add_actor(rows);
        return rows;
    },

    _buildCalcSection: function(query) {
        if (!_isMathExpression(query))
            return false;

        let result = _evaluateMathExpression(query);
        if (result === null)
            return false;

        let rows = this._addSection('Calculadora');
        let calculatorExpression = _prepareCalculatorExpression(query);
        let resultText = String(result);
        let icon = new St.Icon({
            icon_name: 'accessories-calculator-symbolic',
            icon_size: 28,
            style: 'color: ' + this._accent + ';'
        });

        let textBox = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 4px;'
        });
        let expressionLabel = new St.Label({
            text: _singleLine(query, MAX_MATH_EXPRESSION_LENGTH),
            style: 'color: ' + this._textSec + '; font-size: 12px;'
        });
        expressionLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        let resultLabel = new St.Label({
            text: '= ' + resultText,
            style: 'color: ' + this._accent + '; font-size: 23px;' +
                   'font-weight: bold;'
        });
        let actionLabel = new St.Label({
            text: 'Abrir este cálculo na calculadora',
            style: 'color: ' + this._textSec + '; font-size: 11px;'
        });
        textBox.add_actor(expressionLabel);
        textBox.add_actor(resultLabel);
        textBox.add_actor(actionLabel);

        rows.add_actor(this._wrapRow(
            icon,
            textBox,
            this._accentSoft,
            this._accentHover,
            () => {
                if (this._openCalculator(calculatorExpression, result))
                    Main.overview.hide();
            }
        ));
        return true;
    },

    _spawnCalculator: function(argv) {
        try {
            Util.spawn(argv);
            return true;
        } catch (e) {
            global.logError('SearchResults calculator launch: ' + e);
            return false;
        }
    },

    _copyCalculatorResult: function(result) {
        try {
            St.Clipboard.get_default().set_text(
                St.ClipboardType.CLIPBOARD,
                String(result)
            );
            return true;
        } catch (e) {
            global.logError('SearchResults calculator clipboard: ' + e);
            return false;
        }
    },

    _notifyCalculatorFallback: function(message) {
        try {
            Main.notify('Calculadora', message);
        } catch (e) {}
    },

    _openCalculator: function(expression, result) {
        // GNOME Calculator has a real GUI preload option. A literal "\\n"
        // becomes a newline through GLib string compression inside the app;
        // the empty line then asks Calculator to solve the supplied expression.
        let gnomeCalculator = GLib.find_program_in_path('gnome-calculator');
        if (gnomeCalculator && this._spawnCalculator([
            gnomeCalculator,
            '--equation',
            expression + '\\n'
        ])) {
            return true;
        }

        let appSystem = Cinnamon.AppSystem.get_default();
        let gnomeFlatpakApp = appSystem.lookup_app(
            'org.gnome.Calculator.desktop'
        );
        let flatpak = GLib.find_program_in_path('flatpak');
        if (gnomeFlatpakApp && flatpak && this._spawnCalculator([
            flatpak,
            'run',
            'org.gnome.Calculator',
            '--equation',
            expression + '\\n'
        ])) {
            return true;
        }

        // Qalculate accepts a remaining command-line argument as an expression,
        // puts it in the GUI and evaluates it.
        let qalculate = GLib.find_program_in_path('qalculate-gtk');
        if (qalculate && this._spawnCalculator([qalculate, expression]))
            return true;

        // MATE Calculator, Galculator and KCalc do not expose a stable GUI
        // preload argument. Copy the result before opening one of them so the
        // fallback is explicit and still useful instead of silently opening blank.
        let copied = this._copyCalculatorResult(result);
        let fallbackIds = [
            'mate-calc.desktop',
            'galculator.desktop',
            'kcalc.desktop'
        ];

        for (let i = 0; i < fallbackIds.length; i++) {
            let app = appSystem.lookup_app(fallbackIds[i]);
            if (!app)
                continue;

            app.open_new_window(-1);
            if (copied) {
                this._notifyCalculatorFallback(
                    'Resultado copiado. Cole com Ctrl+V na calculadora.'
                );
            }
            return true;
        }

        let fallbackCommands = ['mate-calc', 'galculator', 'kcalc'];
        for (let i = 0; i < fallbackCommands.length; i++) {
            let command = GLib.find_program_in_path(fallbackCommands[i]);
            if (!command)
                continue;

            if (this._spawnCalculator([command])) {
                if (copied) {
                    this._notifyCalculatorFallback(
                        'Resultado copiado. Cole com Ctrl+V na calculadora.'
                    );
                }
                return true;
            }
        }

        if (copied) {
            this._notifyCalculatorFallback(
                'Nenhuma calculadora compatível foi encontrada; o resultado foi copiado.'
            );
        } else {
            this._notifyCalculatorFallback(
                'Nenhuma calculadora compatível foi encontrada.'
            );
        }
        return false;
    },

    _loadApps: function() {
        try {
            if (typeof AppGrid.getAppCatalog === 'function') {
                this._allApps = AppGrid.getAppCatalog();
                return;
            }

            let appSystem = Cinnamon.AppSystem.get_default();
            let CMenu = imports.gi.CMenu;
            let root = appSystem.get_tree().get_root_directory();
            let seen = new Set();

            let walk = (dir) => {
                let iter = dir.iter();
                let type;

                while ((type = iter.next()) !== CMenu.TreeItemType.INVALID) {
                    if (type === CMenu.TreeItemType.ENTRY) {
                        let id = iter.get_entry().get_desktop_file_id();
                        let app = appSystem.lookup_app(id);

                        if (!app || app.get_nodisplay() || seen.has(app.get_id()))
                            continue;

                        let name = _singleLine(app.get_name(), 160);
                        let description = '';
                        try {
                            description = _singleLine(
                                app.get_description(),
                                240
                            );
                        } catch (e) {}

                        this._allApps.push({
                            app: app,
                            displayName: name,
                            description: description,
                            name: _normalize(name),
                            searchText: _normalize(name + ' ' + description)
                        });
                        seen.add(app.get_id());
                    } else if (type === CMenu.TreeItemType.DIRECTORY) {
                        walk(iter.get_directory());
                    }
                }
            };

            if (root)
                walk(root);

            this._allApps.sort((a, b) =>
                a.displayName.localeCompare(b.displayName));
        } catch (e) {
            global.logError('SearchResults._loadApps: ' + e);
        }
    },

    _buildAppsSection: function(query) {
        let matches;
        if (typeof AppGrid.findAppMatches === 'function') {
            matches = AppGrid.findAppMatches(
                this._allApps,
                query,
                MAX_APP_RESULTS
            );
        } else {
            let normalizedQuery = _normalize(query);
            matches = this._allApps.filter(entry => {
                let haystack = entry.searchText || entry.name || '';
                return haystack.indexOf(normalizedQuery) !== -1;
            }).slice(0, MAX_APP_RESULTS);
        }

        if (matches.length === 0)
            return;

        let rows = this._addSection('Aplicativos');

        for (let i = 0; i < matches.length; i++) {
            let match = matches[i];
            let icon = AppGrid.createAppIcon(match.app, 30);
            let textBox = new St.BoxLayout({
                vertical: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 3px;'
            });
            let nameLabel = new St.Label({
                text: match.displayName ||
                      _singleLine(match.app.get_name(), 160),
                style: 'color: ' + this._textPri + '; font-size: 14px;' +
                       'font-weight: bold;'
            });
            nameLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            textBox.add_actor(nameLabel);

            let description = match.description;
            if (description === undefined) {
                try {
                    description = match.app.get_description
                        ? match.app.get_description()
                        : null;
                } catch (e) {
                    description = null;
                }
            }
            if (description) {
                let descriptionLabel = new St.Label({
                    text: _singleLine(description, 240),
                    style: 'color: ' + this._textSec + '; font-size: 11px;'
                });
                descriptionLabel.clutter_text.set_ellipsize(
                    Pango.EllipsizeMode.END
                );
                textBox.add_actor(descriptionLabel);
            }

            rows.add_actor(this._wrapRow(
                icon,
                textBox,
                null,
                null,
                () => {
                    AppGrid.activateApp(match.app);
                },
                this._onOpenAppContextMenu
                    ? (sourceActor) => {
                        this._onOpenAppContextMenu(
                            match.app,
                            sourceActor
                        );
                    }
                    : null
            ));
        }
    },

    _getRecentFileCandidates: function(queryInfo) {
        let candidates = [];
        let seenPaths = new Set();

        try {
            if (!Cinnamon.DocSystem ||
                typeof Cinnamon.DocSystem.get_default !== 'function')
                return candidates;

            let docSystem = Cinnamon.DocSystem.get_default();
            let recentInfos = docSystem && docSystem.get_all
                ? Array.from(docSystem.get_all() || [])
                : [];

            for (let i = 0; i < recentInfos.length; i++) {
                let info = recentInfos[i];
                let uri = info && info.get_uri ? info.get_uri() : null;
                if (!uri || uri.indexOf('file:') !== 0)
                    continue;

                let file = Gio.File.new_for_uri(uri);
                let path = file.get_path();
                if (!path || seenPaths.has(path))
                    continue;

                let name = '';
                try {
                    name = info.get_display_name();
                } catch (e) {}
                if (!name)
                    name = GLib.path_get_basename(path);

                let modifiedSeconds = 0;
                try {
                    modifiedSeconds = Number(info.get_modified());
                } catch (e) {}

                let score = _scoreFileCandidate(name, queryInfo, {
                    recentRank: i,
                    modifiedSeconds: modifiedSeconds,
                    priorityBonus: 24,
                    depth: 0
                });
                if (score === null)
                    continue;

                let icon = null;
                try {
                    if (typeof info.get_gicon === 'function')
                        icon = info.get_gicon();
                } catch (e) {}

                seenPaths.add(path);
                candidates.push({
                    path: path,
                    name: name,
                    isDirectory: false,
                    icon: icon,
                    score: score,
                    recent: true
                });
            }
        } catch (e) {
            // Recent documents are an optional fast path. Fall back silently to
            // bounded asynchronous enumeration on older Cinnamon versions.
        }

        candidates.sort(_compareFileCandidates);
        return candidates;
    },

    _getPriorityFileSearchRoots: function() {
        let paths = [];
        let seen = new Set();
        let directoryNames = [
            'DIRECTORY_DESKTOP',
            'DIRECTORY_DOCUMENTS',
            'DIRECTORY_DOWNLOAD',
            'DIRECTORY_PICTURES',
            'DIRECTORY_MUSIC',
            'DIRECTORY_VIDEOS'
        ];

        for (let i = 0; i < directoryNames.length; i++) {
            try {
                let enumValue = GLib.UserDirectory[directoryNames[i]];
                let path = GLib.get_user_special_dir(enumValue);
                if (path && path !== HOME_DIR && !seen.has(path)) {
                    seen.add(path);
                    paths.push(path);
                }
            } catch (e) {}
        }

        if (!seen.has(HOME_DIR))
            paths.push(HOME_DIR);
        return paths;
    },

    _startFileSearch: function(query, generation) {
        let queryInfo = _prepareFileSearchQuery(query);
        if (queryInfo.compactLength < 2)
            return;

        let limits = _getFileSearchLimits(queryInfo);
        let cancellable = new Gio.Cancellable();
        this._fileSearchCancellable = cancellable;
        let startedAtMs = GLib.get_monotonic_time() / 1000;
        let candidateMap = new Map();
        let queue = [];
        let queuedPaths = new Set();
        let directoriesVisited = 0;
        let finished = false;
        let attributes = [
            'standard::name',
            'standard::display-name',
            'standard::type',
            'standard::is-hidden',
            'standard::icon',
            'time::modified'
        ].join(',');

        let overBudget = () =>
            (GLib.get_monotonic_time() / 1000 - startedAtMs) >=
                limits.maxTimeMs;

        let pruneCandidates = () => {
            if (candidateMap.size <= limits.maxCandidates)
                return;

            let best = Array.from(candidateMap.values())
                .sort(_compareFileCandidates)
                .slice(0, limits.maxCandidates);
            candidateMap = new Map();
            for (let i = 0; i < best.length; i++)
                candidateMap.set(best[i].path, best[i]);
        };

        let addCandidate = (candidate) => {
            if (!candidate || !candidate.path)
                return;

            let existing = candidateMap.get(candidate.path);
            if (!existing || candidate.score > existing.score)
                candidateMap.set(candidate.path, candidate);

            if (candidateMap.size > limits.maxCandidates * 2)
                pruneCandidates();
        };

        let recent = this._getRecentFileCandidates(queryInfo);
        for (let i = 0; i < recent.length; i++)
            addCandidate(recent[i]);

        let finish = () => {
            if (finished ||
                !this._isCurrentFileSearch(generation, cancellable))
                return;

            finished = true;
            pruneCandidates();
            let matches = Array.from(candidateMap.values())
                .sort(_compareFileCandidates)
                .slice(0, MAX_FILE_RESULTS);
            this._fileSearchCancellable = null;

            if (matches.length === 0 || this._lastQuery !== query)
                return;

            let rows = this._addSection('Arquivos');
            for (let i = 0; i < matches.length; i++)
                rows.add_actor(this._makeFileRow(matches[i]));
        };

        // Five recent matches already give a high-quality result without any
        // filesystem traversal. Two-character searches also stop at three
        // recent matches because their disk search would be disproportionately
        // broad for little extra value.
        if (recent.length >= MAX_FILE_RESULTS ||
            (queryInfo.compactLength <= 2 && recent.length >= 3)) {
            finish();
            return;
        }

        let enqueuePath = (path, depth, priorityBonus) => {
            if (!path || queuedPaths.has(path) ||
                queuedPaths.size >= limits.maxDirectories)
                return;

            queuedPaths.add(path);
            queue.push({
                file: Gio.File.new_for_path(path),
                depth: depth,
                priorityBonus: priorityBonus
            });
        };

        let enqueueFile = (file, depth, priorityBonus) => {
            let path = null;
            try {
                path = file.get_path();
            } catch (e) {}
            enqueuePath(path, depth, priorityBonus);
        };

        let roots = this._getPriorityFileSearchRoots();
        for (let i = 0; i < roots.length; i++) {
            enqueuePath(
                roots[i],
                0,
                Math.max(0, 38 - i * 5)
            );
        }

        let processNextDirectory = null;

        let readBatch = (enumerator, parentFile, parentDepth, priorityBonus) => {
            if (!this._isCurrentFileSearch(generation, cancellable)) {
                try {
                    enumerator.close(null);
                } catch (e) {}
                return;
            }

            if (overBudget()) {
                try {
                    enumerator.close(null);
                } catch (e) {}
                finish();
                return;
            }

            enumerator.next_files_async(
                FILE_SEARCH_BATCH_SIZE,
                GLib.PRIORITY_LOW,
                cancellable,
                (source, result) => {
                    let infos;
                    try {
                        infos = source.next_files_finish(result);
                    } catch (e) {
                        try {
                            source.close(null);
                        } catch (closeError) {}

                        if (this._isCurrentFileSearch(generation, cancellable))
                            processNextDirectory();
                        return;
                    }

                    if (!this._isCurrentFileSearch(generation, cancellable)) {
                        try {
                            source.close(null);
                        } catch (e) {}
                        return;
                    }

                    if (!infos || infos.length === 0) {
                        try {
                            source.close(null);
                        } catch (e) {}
                        processNextDirectory();
                        return;
                    }

                    for (let i = 0; i < infos.length; i++) {
                        let info = infos[i];
                        let name = info.get_name();
                        if (!name)
                            continue;

                        let hidden = name.charAt(0) === '.';
                        try {
                            hidden = hidden || info.get_is_hidden();
                        } catch (e) {}
                        if (hidden)
                            continue;

                        let child = parentFile.get_child(name);
                        let type = info.get_file_type();
                        let childDepth = parentDepth + 1;
                        let isDirectory = type === Gio.FileType.DIRECTORY;
                        let displayName = name;
                        try {
                            displayName = info.get_display_name() || name;
                        } catch (e) {}

                        let modifiedSeconds = 0;
                        try {
                            modifiedSeconds = Number(
                                info.get_attribute_uint64('time::modified')
                            );
                        } catch (e) {}

                        let score = _scoreFileCandidate(
                            displayName,
                            queryInfo,
                            {
                                depth: childDepth,
                                priorityBonus: priorityBonus,
                                modifiedSeconds: modifiedSeconds
                            }
                        );
                        if (score !== null) {
                            let path = child.get_path();
                            if (path) {
                                let icon = null;
                                try {
                                    icon = info.get_icon();
                                } catch (e) {}

                                addCandidate({
                                    path: path,
                                    name: displayName,
                                    isDirectory: isDirectory,
                                    icon: icon,
                                    score: score,
                                    recent: false
                                });
                            }
                        }

                        if (isDirectory &&
                            childDepth < limits.maxDepth &&
                            queuedPaths.size < limits.maxDirectories) {
                            enqueueFile(
                                child,
                                childDepth,
                                Math.max(0, priorityBonus - 2)
                            );
                        }
                    }

                    if (overBudget()) {
                        try {
                            source.close(null);
                        } catch (e) {}
                        finish();
                    } else {
                        readBatch(
                            source,
                            parentFile,
                            parentDepth,
                            priorityBonus
                        );
                    }
                }
            );
        };

        processNextDirectory = () => {
            if (!this._isCurrentFileSearch(generation, cancellable))
                return;

            if (queue.length === 0 ||
                directoriesVisited >= limits.maxDirectories ||
                overBudget()) {
                finish();
                return;
            }

            let item = queue.shift();
            directoriesVisited++;
            item.file.enumerate_children_async(
                attributes,
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                GLib.PRIORITY_LOW,
                cancellable,
                (source, result) => {
                    let enumerator;
                    try {
                        enumerator = source.enumerate_children_finish(result);
                    } catch (e) {
                        if (this._isCurrentFileSearch(generation, cancellable))
                            processNextDirectory();
                        return;
                    }

                    if (!this._isCurrentFileSearch(generation, cancellable)) {
                        try {
                            enumerator.close(null);
                        } catch (e) {}
                        return;
                    }

                    readBatch(
                        enumerator,
                        item.file,
                        item.depth,
                        item.priorityBonus
                    );
                }
            );
        };

        processNextDirectory();
    },

    _makeFileRow: function(fileResult) {
        let displayPath = fileResult.path.indexOf(HOME_DIR) === 0
            ? '~' + fileResult.path.slice(HOME_DIR.length)
            : fileResult.path;
        let displayName = _singleLine(fileResult.name, 240);
        let safeDisplayPath = _singleLine(displayPath, 512);
        let fileIcon;
        if (fileResult.icon) {
            fileIcon = new St.Icon({
                gicon: fileResult.icon,
                icon_size: 26,
                style: 'color: rgba(223,228,240,0.88);'
            });
        } else {
            fileIcon = new St.Icon({
                icon_name: fileResult.isDirectory
                    ? 'folder-symbolic'
                    : 'text-x-generic-symbolic',
                icon_size: 26,
                style: 'color: rgba(223,228,240,0.88);'
            });
        }

        let textBox = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 2px;'
        });
        let nameLabel = new St.Label({
            text: displayName,
            style: 'color: ' + this._textPri + '; font-size: 14px;' +
                   'font-weight: bold;'
        });
        nameLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        let pathLabel = new St.Label({
            text: safeDisplayPath,
            style: 'color: ' + this._textSec + '; font-size: 11px;'
        });
        pathLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.START);
        textBox.add_actor(nameLabel);
        textBox.add_actor(pathLabel);

        return this._wrapRow(
            fileIcon,
            textBox,
            null,
            null,
            () => {
                try {
                    Gio.app_info_launch_default_for_uri(
                        Gio.File.new_for_path(fileResult.path).get_uri(),
                        global.create_app_launch_context()
                    );
                } catch (e) {
                    imports.misc.util.spawn(['xdg-open', fileResult.path]);
                }
                Main.overview.hide();
            }
        );
    },

    _buildWebSection: function(query) {
        let rows = this._addSection('Web');
        let globe = new St.Icon({
            icon_name: 'web-browser-symbolic',
            icon_size: 26,
            style: 'color: rgba(223,228,240,0.88);'
        });
        let textBox = new St.BoxLayout({
            vertical: true,
            style: 'spacing: 1px;'
        });
        let mainLabel = new St.Label({
            text: 'Pesquisar "' + query + '" no Google',
            style: 'color: ' + this._textPri + '; font-size: 13px;'
        });
        mainLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        let subLabel = new St.Label({
            text: 'Abre no navegador padrão',
            style: 'color: ' + this._textSec + '; font-size: 11px;'
        });
        textBox.add_actor(mainLabel);
        textBox.add_actor(subLabel);

        rows.add_actor(this._wrapRow(
            globe,
            textBox,
            null,
            null,
            () => {
                let uri = 'https://www.google.com/search?q=' +
                          encodeURIComponent(query);
                try {
                    Gio.app_info_launch_default_for_uri(
                        uri,
                        global.create_app_launch_context()
                    );
                } catch (e) {
                    imports.misc.util.spawn(['xdg-open', uri]);
                }
                Main.overview.hide();
            }
        ));
    },

    // Keyboard navigation for the vertical result list.
    focusFirst: function() {
        return this._focusResultAt(0);
    },

    focusLast: function() {
        return this._focusResultAt(this._resultButtons.length - 1);
    },

    _getFocusedResultIndex: function() {
        return this._resultButtons.indexOf(global.stage.get_key_focus());
    },

    containsKeyboardFocus: function() {
        return this._getFocusedResultIndex() >= 0;
    },

    resetNavigation: function() {
        // Focus is moved back to the search entry by overview.js when changing
        // views. No separate selection object is retained here.
    },

    handleKey: function(symbol) {
        if (this._resultButtons.length === 0)
            return false;

        let index = this._getFocusedResultIndex();

        if (symbol === Clutter.KEY_Return ||
            symbol === Clutter.KEY_KP_Enter ||
            symbol === Clutter.KEY_space) {
            if (index < 0)
                return this.focusFirst();

            let button = this._resultButtons[index];
            if (button && button._overviewActivate)
                button._overviewActivate();
            return true;
        }

        if (index < 0) {
            if (symbol === Clutter.KEY_Up ||
                symbol === Clutter.KEY_KP_Up ||
                symbol === Clutter.KEY_Left ||
                symbol === Clutter.KEY_KP_Left ||
                symbol === Clutter.KEY_End ||
                symbol === Clutter.KEY_KP_End)
                return this.focusLast();

            if (symbol === Clutter.KEY_Down ||
                symbol === Clutter.KEY_KP_Down ||
                symbol === Clutter.KEY_Right ||
                symbol === Clutter.KEY_KP_Right ||
                symbol === Clutter.KEY_Home ||
                symbol === Clutter.KEY_KP_Home ||
                symbol === Clutter.KEY_Page_Up ||
                symbol === Clutter.KEY_KP_Page_Up ||
                symbol === Clutter.KEY_Page_Down ||
                symbol === Clutter.KEY_KP_Page_Down)
                return this.focusFirst();

            return false;
        }

        let target = index;
        switch (symbol) {
            case Clutter.KEY_Up:
            case Clutter.KEY_KP_Up:
            case Clutter.KEY_Left:
            case Clutter.KEY_KP_Left:
                // Returning false lets overview.js move focus to the search
                // field when the first result is reached.
                if (index === 0)
                    return false;
                target = index - 1;
                break;
            case Clutter.KEY_Down:
            case Clutter.KEY_KP_Down:
                if (index === this._resultButtons.length - 1) {
                    this._focusSearchEntry();
                    return true;
                }
                target = index + 1;
                break;
            case Clutter.KEY_Right:
            case Clutter.KEY_KP_Right:
                if (index === this._resultButtons.length - 1)
                    return true;
                target = index + 1;
                break;
            case Clutter.KEY_Home:
            case Clutter.KEY_KP_Home:
                target = 0;
                break;
            case Clutter.KEY_End:
            case Clutter.KEY_KP_End:
                target = this._resultButtons.length - 1;
                break;
            case Clutter.KEY_Page_Up:
            case Clutter.KEY_KP_Page_Up:
                target = Math.max(0, index - 5);
                break;
            case Clutter.KEY_Page_Down:
            case Clutter.KEY_KP_Page_Down:
                target = Math.min(
                    this._resultButtons.length - 1,
                    index + 5
                );
                break;
            default:
                return false;
        }

        return this._focusResultAt(target);
    },

    _focusResultAt: function(index) {
        if (index < 0 || index >= this._resultButtons.length)
            return false;

        let button = this._resultButtons[index];
        if (!button)
            return false;

        try {
            button.grab_key_focus();
        } catch (e) {
            global.stage.set_key_focus(button);
        }

        this._cancelFocusScroll();
        this._focusScrollIdleId = Mainloop.idle_add(() => {
            this._focusScrollIdleId = 0;
            if (!this._destroyed)
                this._ensureResultVisible(button);
            return false;
        });
        return true;
    },

    _focusSearchEntry: function() {
        if (this._onNavigateToSearch)
            this._onNavigateToSearch();
    },

    _onResultKeyPress: function(button, event) {
        let symbol = event.get_key_symbol();
        let modifiers = Cinnamon.get_event_state(event);
        let openContextMenu = symbol === Clutter.KEY_Menu ||
            (symbol === Clutter.KEY_F10 &&
             (modifiers & Clutter.ModifierType.SHIFT_MASK));

        if (openContextMenu && button._overviewOpenContext) {
            button._overviewOpenContext();
            return true;
        }

        let handled = this.handleKey(symbol);

        if (!handled && button._overviewSearchIndex === 0) {
            if (symbol === Clutter.KEY_Up ||
                symbol === Clutter.KEY_KP_Up ||
                symbol === Clutter.KEY_Left ||
                symbol === Clutter.KEY_KP_Left) {
                this._focusSearchEntry();
                return true;
            }
        }

        return handled;
    },

    _ensureResultVisible: function(button) {
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
            let margin = 12;
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
            // The scrollbar can be created lazily while async results arrive.
        }
    },

    _wrapRow: function(
        iconActor,
        textBox,
        normalBg,
        hoverBg,
        action,
        contextAction
    ) {
        let base = 'border-radius: 14px; padding: 10px 16px;' +
                   'margin: 2px 10px; border: 1px solid transparent;';
        let background = normalBg || 'transparent';
        let hoverBackground = hoverBg || this._rowHoverBg;
        let normalStyle = base + 'background-color: ' + background + ';';
        let activeStyle = base +
            'background-color: ' + hoverBackground + ';' +
            'border-color: rgba(255,255,255,0.075);';

        let button = new St.Button({
            reactive: !!action,
            can_focus: !!action,
            track_hover: !!action,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style: normalStyle
        });
        let row = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 14px;'
        });

        if (iconActor) {
            let iconBin = new St.Bin({
                width: 38,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                child: iconActor
            });
            row.add(iconBin, {
                x_fill: false,
                y_fill: false,
                x_align: St.Align.MIDDLE
            });
        }

        if (textBox) {
            textBox.x_expand = true;
            textBox.y_align = Clutter.ActorAlign.CENTER;
            row.add(textBox, {
                expand: true,
                x_fill: true,
                y_fill: false
            });
        }

        button.set_child(row);

        if (action) {
            try {
                button.set_pivot_point(0.5, 0.5);
            } catch (e) {}

            let hovered = false;
            let focused = false;
            let updateState = () => {
                let active = hovered || focused;
                button.set_style(active ? activeStyle : normalStyle);
                button.remove_all_transitions();
                button.ease({
                    scale_x: active ? 1.012 : 1.0,
                    scale_y: active ? 1.012 : 1.0,
                    duration: active ? 100 : 130,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
            };

            button._overviewActivate = action;
            button.connect('clicked', action);
            if (typeof contextAction === 'function') {
                button._overviewOpenContext = () =>
                    contextAction(button);
                button.connect('button-press-event', (actor, event) => {
                    if (event.get_button() !== 3)
                        return false;

                    button._overviewOpenContext();
                    return true;
                });
            }
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
            button._overviewSearchIndex = this._resultButtons.length;
            this._resultButtons.push(button);
            button.connect('key-press-event', (actor, event) =>
                this._onResultKeyPress(actor, event));
        }

        return button;
    }
};
