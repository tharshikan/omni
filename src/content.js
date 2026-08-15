// Workaround to capture Esc key on certain sites
var isOpen = false;
document.onkeyup = (e) => {
	if (e.key == "Escape" && isOpen) {
		chrome.runtime.sendMessage({request:"close-omni"})
	}
}

$(document).ready(() => {
	var actions = [];
	var isFiltered = false;
	var currentMode = "default";
	var recentActions = [];
	var recentQuery = "";
	var recentShortcuts = [
		{title:"Gemini", url:"https://gemini.google.com/app", icon:"assets/icon-gemini.svg"},
		{title:"Google", url:"https://www.google.com", icon:"assets/icon-google.svg"},
		{title:"YouTube", url:"https://www.youtube.com", icon:"assets/icon-youtube.svg"},
		{title:"Music", url:"https://music.youtube.com", icon:"assets/icon-music.svg"},
		{title:"Gmail", url:"https://mail.google.com", icon:"assets/icon-gmail.svg"},
		{title:"Settings", request:"settings", icon:"assets/icon-settings.svg"},
		{title:"Extensions", request:"extensions", icon:"assets/icon-extensions.svg"},
		{title:"History", request:"history", icon:"assets/icon-history.svg"}
	];

	// The explorer drawer behaves like recents, just rendered as a side panel
	function isRecentLike() {
		return currentMode == "recent" || currentMode == "explorer";
	}

	// Explorer-style search (all tabs in order, dim non-matches) applies to
	// the drawer always, and to the recents palette when the user opts in
	var paletteExplorerFlow = false;
	function isExplorerFlow() {
		return currentMode == "explorer" || (currentMode == "recent" && paletteExplorerFlow);
	}
	chrome.storage.local.get("leapPaletteExplorerFlow").then((data) => {
		paletteExplorerFlow = !!(data && data.leapPaletteExplorerFlow);
	});

	// Apply the chosen theme by writing its variables onto the UI roots;
	// "auto" clears them so the system palette in the stylesheet wins
	var currentTheme = "bright";
	var themeVars = ["--panel", "--panel-solid", "--panel-border", "--hairline", "--edge", "--text", "--text-2", "--text-3", "--select", "--select-hover", "--accent", "--key-bg", "--key-border", "--placeholder", "--overlay", "--match", "--shadow"];
	function applyTheme(name) {
		currentTheme = name || "auto";
		var theme = (typeof LEAP_THEMES !== "undefined") ? LEAP_THEMES[currentTheme] : null;
		var noFrost = !!(theme && theme.frost === false);
		[$("#omni-extension").get(0), $("#omni-extension-toast").get(0)].forEach((el) => {
			if (!el) {
				return;
			}
			el.classList.toggle("omni-no-frost", noFrost);
			themeVars.forEach((varName) => {
				if (theme && theme.vars[varName]) {
					el.style.setProperty(varName, theme.vars[varName]);
				} else {
					el.style.removeProperty(varName);
				}
			});
		});
	}
	chrome.storage.local.get("leapTheme").then((data) => {
		applyTheme((data && data.leapTheme) || "bright");
	});
	if (chrome.storage.onChanged) {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area == "local" && changes.leapTheme) {
				applyTheme(changes.leapTheme.newValue || "bright");
			}
		});
	}

	function updateRecentFilterVisibility() {
		var hasQuery = $("#omni-extension input").val().length > 0;
		$("#omni-extension").toggleClass("omni-recent-mode", currentMode == "recent");
		$("#omni-extension").toggleClass("omni-explorer-mode", currentMode == "explorer");
		$("#omni-extension").toggleClass("omni-recent-filtering", isRecentLike() && hasQuery);
		$("#omni-recent-query-text").text(recentQuery);
	}

	function updateInputPlaceholder() {
		var placeholder = isRecentLike() ? "Search recent tabs and actions" : "Type a command or search";
		$("#omni-extension input").attr("placeholder", placeholder);
	}

	function clearActiveState() {
		$(".omni-item-active").removeClass("omni-item-active");
		$(".omni-shortcut-item-active").removeClass("omni-shortcut-item-active");
	}

	function activateElement(element) {
		if (!element || !element.length) {
			return;
		}
		clearActiveState();
		if (element.hasClass("omni-item")) {
			element.addClass("omni-item-active");
			positionSelectionPill(element);
			element[0].scrollIntoView({block:"nearest", inline:"nearest"});
		} else if (element.hasClass("omni-shortcut-item")) {
			element.addClass("omni-shortcut-item-active");
		}
	}

	// The selection is a pill that glides between rows rather than a
	// background that snaps. It is re-created on every populate; its first
	// placement is instant, every move after that is animated.
	function positionSelectionPill(element) {
		var pill = document.getElementById("omni-selection");
		if (!pill || !element.hasClass("omni-item")) {
			return;
		}
		var el = element.get(0);
		var firstPlacement = pill.dataset.placed !== "true";
		if (firstPlacement) {
			pill.style.transition = "none";
		}
		pill.style.height = el.offsetHeight + "px";
		pill.style.transform = "translateY(" + el.offsetTop + "px)";
		pill.style.opacity = "1";
		if (firstPlacement) {
			pill.getBoundingClientRect();
			pill.style.transition = "";
			pill.dataset.placed = "true";
		}
	}

	function setDefaultActiveItem() {
		clearActiveState();
		var visibleItems = $(".omni-extension #omni-list .omni-item:visible");
		if (!visibleItems.length) {
			return;
		}
		if (isExplorerFlow()) {
			// File-explorer semantics: open with the current tab highlighted
			var currentItem = visibleItems.filter(function() {
				return $(this).attr("data-current-tab") == "true";
			}).first();
			if (currentItem.length) {
				activateElement(currentItem);
				return;
			}
		}
		if (isRecentLike()) {
			var nonCurrentItem = visibleItems.filter(function() {
				return $(this).attr("data-current-tab") != "true";
			}).first();
			if (nonCurrentItem.length) {
				activateElement(nonCurrentItem);
				return;
			}
		}
		activateElement(visibleItems.first());
	}

	function scoreRecentAction(action, query) {
		var title = (action.title || "").toLowerCase();
		var desc = (action.desc || "").toLowerCase();
		// The subline shows a clean domain, but the full URL stays searchable
		var url = (action.url || "").toLowerCase();
		var normalizedTitle = title.replace(/^["'`]+|["'`]+$/g, "");
		var score = 0;
		if (title.startsWith(query)) {
			score += 6;
		} else if (new RegExp("(^|[\\s\\-_\\/])" + query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(title)) {
			score += 5;
		} else if (title.indexOf(query) > -1) {
			score += 3;
		}
		if (desc.indexOf(query) > -1 || url.indexOf(query) > -1) {
			score += 1;
		}
		if (normalizedTitle === query) {
			score -= 4;
		}
		if (normalizedTitle.length <= query.length + 2) {
			score -= 1;
		}
		return score;
	}

	function escapeHtml(value) {
		return (value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	function highlightRecentMatch(value, query) {
		var safeValue = escapeHtml(value || "");
		if (!isRecentLike() || !query) {
			return safeValue;
		}
		var lowerValue = (value || "").toLowerCase();
		var index = lowerValue.indexOf(query.toLowerCase());
		if (index === -1) {
			return safeValue;
		}
		var start = escapeHtml((value || "").slice(0, index));
		var match = escapeHtml((value || "").slice(index, index + query.length));
		var end = escapeHtml((value || "").slice(index + query.length));
		return start + "<span class='omni-match'>" + match + "</span>" + end;
	}

	function renderRecentShortcuts() {
		$("#omni-shortcuts").html("");
		recentShortcuts.forEach((shortcut, index) => {
			var iconUrl = chrome.runtime.getURL(shortcut.icon);
			$("#omni-shortcuts").append("<button class='omni-shortcut-item' data-index='"+index+"' title='"+escapeHtml(shortcut.title)+"'><img class='omni-shortcut-icon' src='"+iconUrl+"' alt='"+escapeHtml(shortcut.title)+"'></button>");
		});
	}

	// Append the omni into the current page
	$.get(chrome.runtime.getURL('/content.html'), (data) => {
		$(data).appendTo('body');
		updateInputPlaceholder();
		updateRecentFilterVisibility();
		renderRecentShortcuts();
		if (navigator.platform.toUpperCase().indexOf("MAC") < 0) {
			$("#omni-close-key").text("Ctrl⌫");
		}
		applyTheme(currentTheme);

		// Get checkmark image for toast
		$("#omni-extension-toast img").attr("src", chrome.runtime.getURL("assets/check.svg"));

		// Request actions from the background
		chrome.runtime.sendMessage({request:"get-actions"}, (response) => {
			actions = response.actions;
		});

		// New tab page workaround
		if (window.location.href == chrome.runtime.getURL("newtab.html")) {
			chrome.runtime.sendMessage({request:"get-launch-mode"}, (response) => {
				openOmni(response && response.mode ? response.mode : "default");
			});
		}
	});

	function renderAction(action, index, keys, img) {
		var skip = "";
		if (action.action == "search" || action.action == "goto") {
			skip = "style='display:none'";
		}
		var actionTitle = isRecentLike() ? highlightRecentMatch(action.title, recentQuery) : escapeHtml(action.title);
		var actionDesc = escapeHtml(action.desc);
		var closeBtn = action.type == "tab" && action.action == "switch-tab" ? "<button class='omni-close-tab' title='Close tab'>✕</button>" : "";
		$("#omni-extension #omni-list").append("<div class='omni-item' "+skip+" data-index='"+index+"' data-type='"+action.type+"' data-current-tab='"+(action.currentTab ? "true" : "false")+"'>"+img+"<div class='omni-item-details'><div class='omni-item-name'>"+actionTitle+"</div><div class='omni-item-desc'>"+actionDesc+"</div></div>"+keys+"<div class='omni-select'>Select <span class='omni-shortcut'>⏎</span></div>"+closeBtn+"</div>");
		if (!action.emoji) {
			var loadimg = new Image();
			loadimg.src = action.favIconUrl;

			// Favicon doesn't load, use a fallback
			loadimg.onerror = () => {
				$(".omni-item[data-index='"+index+"'] img").attr("src", chrome.runtime.getURL("/assets/globe.svg"));
			}
		}
	}

	// Add actions to the omni
	function populateOmni() {
		$("#omni-extension #omni-list").html("");
		$("#omni-extension #omni-list").addClass("omni-has-pill").append("<div id='omni-selection'></div>");
		var lastSection = null;
		actions.forEach((action, index) => {
			if (action.section && action.section !== lastSection) {
				$("#omni-extension #omni-list").append("<div class='omni-section'>"+escapeHtml(action.section)+"</div>");
				lastSection = action.section;
			}
			var keys = "";
			if (action.keycheck) {
					keys = "<div class='omni-keys'>";
					action.keys.forEach(function(key){
						keys += "<span class='omni-shortcut'>"+key+"</span>";
					});
					keys += "</div>";
			}
			
			// Check if the action has an emoji or a favicon
			if (!action.emoji) {
				var onload = 'if ("naturalHeight" in this) {if (this.naturalHeight + this.naturalWidth === 0) {this.onerror();return;}} else if (this.width + this.height == 0) {this.onerror();return;}';
				var img = "<img src='"+action.favIconUrl+"' alt='favicon' onload='"+onload+"' onerror='this.src=&quot;"+chrome.runtime.getURL("/assets/globe.svg")+"&quot;' class='omni-icon'>";
				renderAction(action, index, keys, img);
			} else {
				var img = "<span class='omni-emoji-action'>"+action.emojiChar+"</span>";
				renderAction(action, index, keys, img);
			}
		})
		$(".omni-extension #omni-results").html(actions.length+" results");
		setDefaultActiveItem();
	}

	// Add filtered actions to the omni
	function populateOmniFilter(actions) {
		isFiltered = true;
		// The virtualized list manages its own DOM; fall back to class-based selection
		$("#omni-extension #omni-list").removeClass("omni-has-pill");
		$("#omni-extension #omni-list").html("");
		const renderRow = (index) => {
			const action = actions[index]
			var keys = "";
			if (action.keycheck) {
					keys = "<div class='omni-keys'>";
					action.keys.forEach(function(key){
						keys += "<span class='omni-shortcut'>"+key+"</span>";
					});
					keys += "</div>";
			}
			var img = "<img src='"+action.favIconUrl+"' alt='favicon' onerror='this.src=&quot;"+chrome.runtime.getURL("/assets/globe.svg")+"&quot;' class='omni-icon'>";
			if (action.emoji) {
				img = "<span class='omni-emoji-action'>"+action.emojiChar+"</span>"
			}
			return $("<div class='omni-item' data-index='"+index+"' data-type='"+action.type+"' data-url='"+action.url+"' data-current-tab='"+(action.currentTab ? "true" : "false")+"'>"+img+"<div class='omni-item-details'><div class='omni-item-name'>"+action.title+"</div><div class='omni-item-desc'>"+(action.desc || action.url)+"</div></div>"+keys+"<div class='omni-select'>Select <span class='omni-shortcut'>⏎</span></div></div>")[0]
		}
		actions.length && new VirtualizedList.default($("#omni-extension #omni-list")[0], {
			height: 400,
			rowHeight: 56,
			rowCount: actions.length,
			renderRow,
			onMount: () => {
				$(".omni-extension #omni-results").html(actions.length+" results");
				setDefaultActiveItem();
			},
		});
	}

	var closeTimer = null;
	var enterTimer = null;

	// Open the omni
	function openOmni(mode) {
		currentMode = mode || "default";
		updateInputPlaceholder();
		const request = isExplorerFlow() ? "get-explorer-tabs" : isRecentLike() ? "get-recents" : "get-actions";
		chrome.runtime.sendMessage({request:request}, (response) => {
			isOpen = true;
			allowHover = false;
			lastMouse = null;
			fallbackState = null;
			actions = response.actions;
			recentActions = isRecentLike() ? response.actions.slice() : [];
			recentQuery = "";
			isFiltered = false;
			$("#omni-extension input").val("");
			$("#omni-flow-checkbox").prop("checked", paletteExplorerFlow);
			updateRecentFilterVisibility();
			// Unhide before populating so setDefaultActiveItem can see the items (:visible)
			window.clearTimeout(closeTimer);
			$("#omni-extension").removeClass("omni-closing omni-hiding");
			// Stagger the first rows in, only for this opening
			$("#omni-extension").addClass("omni-entering");
			window.clearTimeout(enterTimer);
			enterTimer = window.setTimeout(() => {
				$("#omni-extension").removeClass("omni-entering");
			}, 450);
			populateOmni();
			$("html, body").stop();
			// Grab focus right away so the first keystrokes land in the omni,
			// then again shortly after for pages that steal focus back.
			// Native focus() — the jQuery trigger can silently fail.
			var inputEl = $("#omni-extension input").get(0);
			if (inputEl) {
				inputEl.focus();
				focusLock.on(inputEl);
			}
			window.setTimeout(() => {
				if (isOpen && inputEl) {
					inputEl.focus();
				}
			}, 100);
		});
	}

	// Close the omni
	function closeOmni(performedAction) {
		if (window.location.href == chrome.runtime.getURL("newtab.html")) {
			// Restore the page this tab replaced only when dismissing —
			// after a real action the handlers navigate or close this tab,
			// and restoring would steal focus from the destination
			if (!performedAction) {
				chrome.runtime.sendMessage({request:"restore-new-tab"});
			}
		} else {
			isOpen = false;
			var closingMode = currentMode;
			currentMode = "default";
			recentActions = [];
			recentQuery = "";
			var closingInput = $("#omni-extension input").get(0);
			if (closingInput) {
				focusLock.off(closingInput);
				closingInput.blur();
			}
			$("#omni-extension input").val("");
			// Play the exit animation before hiding; keep the mode class so
			// the drawer slides out instead of fading like the palette
			$("#omni-extension").toggleClass("omni-explorer-mode", closingMode == "explorer");
			$("#omni-extension").toggleClass("omni-recent-mode", closingMode == "recent");
			$("#omni-extension").removeClass("omni-recent-filtering");
			$("#omni-extension").addClass("omni-hiding");
			window.clearTimeout(closeTimer);
			closeTimer = window.setTimeout(() => {
				$("#omni-extension").removeClass("omni-hiding");
				$("#omni-extension").addClass("omni-closing");
			}, 160);
		}
	}

	// Hover selection is ignored until the mouse really moves after opening —
	// the browser fires a synthetic mouseover for whatever sits under the
	// resting cursor when the omni appears, which would steal the selection
	var allowHover = false;
	var lastMouse = null;
	$(document).on("mousemove", (e) => {
		if (lastMouse && (lastMouse.x != e.clientX || lastMouse.y != e.clientY)) {
			allowHover = true;
		}
		lastMouse = {x: e.clientX, y: e.clientY};
	});

	// Hover over an action in the omni
	function hoverItem() {
		if (!allowHover) {
			return;
		}
		activateElement($(this));
	}

	function hoverShortcutItem() {
		if (!allowHover) {
			return;
		}
		activateElement($(this));
	}

	// Close a tab row in place: the tab is closed and the palette stays
	// open so several tabs can be pruned in a row
	function closeTabRow(item) {
		var index = parseInt(item.attr("data-index"), 10);
		var action = actions[index];
		if (!action || action.type != "tab" || action.action != "switch-tab") {
			return;
		}
		chrome.runtime.sendMessage({request:"remove", type:"tab", action:action});
		actions.splice(index, 1);
		recentActions = recentActions.filter((recentAction) => !(recentAction.type == "tab" && recentAction.id == action.id));
		populateOmni();
		if (isExplorerFlow() && recentQuery) {
			applyExplorerHighlight(recentActions.map((recentAction) => scoreRecentAction(recentAction, recentQuery.toLowerCase())), true);
		}
		var rows = $("#omni-extension #omni-list .omni-item:visible");
		if (rows.length) {
			activateElement(rows.eq(Math.min(index, rows.length - 1)));
		}
	}

	function closeActiveTabRow() {
		var activeItem = $(".omni-item-active");
		if (activeItem.length) {
			closeTabRow(activeItem);
		}
	}

	function handleShortcutAction(e) {
		var activeShortcut = $(this).hasClass("omni-shortcut-item") ? $(this) : $(".omni-shortcut-item-active");
		if (activeShortcut.length) {
			activateElement(activeShortcut);
		}
		var shortcut = recentShortcuts[activeShortcut.attr("data-index")];
		if (!shortcut) {
			return;
		}
		var onNewTabPage = window.location.href == chrome.runtime.getURL("newtab.html");
		closeOmni(true);
		if (shortcut.request) {
			chrome.runtime.sendMessage({request:shortcut.request});
			if (onNewTabPage) {
				chrome.runtime.sendMessage({request:"close-new-tab"});
			}
		} else if (onNewTabPage) {
			// This tab is a placeholder — navigate it instead of leaving it behind
			window.open(shortcut.url, "_self");
		} else {
			window.open(shortcut.url, "_blank");
		}
	}

	// Show a toast when an action has been performed
	function showToast(action) {
		$("#omni-extension-toast span").html('"'+action.title+'" has been successfully performed');
		$("#omni-extension-toast").addClass("omni-show-toast");
		setTimeout(() => {
			$(".omni-show-toast").removeClass("omni-show-toast");
		}, 3000)
	}

	// Autocomplete commands. Since they all start with different letters, it can be the default behavior
	function checkShortHand(e, value) {
		var el = $(".omni-extension input");
		var isDelete = e.originalEvent && typeof e.originalEvent.inputType == "string" && e.originalEvent.inputType.indexOf("delete") == 0;
		if (!isDelete) {
			if (value == "/t") {
				el.val("/tabs ")
			} else if (value == "/b") {
				el.val("/bookmarks ")
			} else if (value == "/h") {
				el.val("/history ");
			} else if (value == "/r") {
				el.val("/remove ");
			} else if (value == "/a") {
				el.val("/actions ");
			}
		} else {
			if (value == "/tabs" || value == "/bookmarks" || value == "/actions" || value == "/remove" || value == "/history") {
				el.val("");
			}
		}
	}

	// Add protocol
	function addhttp(url) {
			if (!/^(?:f|ht)tps?\:\/\//.test(url)) {
					url = "http://" + url;
			}
			return url;
	}

	// Check if valid url
	function validURL(str) {
		var pattern = new RegExp('^(https?:\\/\\/)?'+ // protocol
			'((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // domain name
			'((\\d{1,3}\\.){3}\\d{1,3}))'+ // OR ip (v4) address
			'(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // port and path
			'(\\?[;&a-z\\d%_.~+=-]*)?'+ // query string
			'(\\#[-a-z\\d_]*)?$','i'); // fragment locator
		return !!pattern.test(str);
	}

	// Score recents and rail shortcuts against a query, best first
	function buildRecentMatches(value) {
		var shortcutCandidates = recentShortcuts.map((shortcut, index) => {
			return {
				action: {
					title: shortcut.title,
					desc: shortcut.url ? shortcut.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "") : "Leap shortcut",
					type: "action",
					action: shortcut.request ? shortcut.request : "url",
					url: shortcut.url,
					favIconUrl: chrome.runtime.getURL(shortcut.icon),
					emoji: false,
					keycheck: false,
					currentTab: false
				},
				index: recentActions.length + index
			};
		});
		return recentActions.map((action, index) => {
			return {
				action: action,
				index: index
			};
		}).concat(shortcutCandidates)
			.map((item) => {
				item.score = scoreRecentAction(item.action, value);
				return item;
			})
			.filter((item) => item.score > 0)
			.sort((a, b) => {
				if (b.score !== a.score) {
					return b.score - a.score;
				}
				if (a.action.currentTab !== b.action.currentTab) {
					// The tab you are already on is never "the right one" to switch to
					return a.action.currentTab ? 1 : -1;
				}
				return a.index - b.index;
			})
			.map((item) => item.action);
	}

	// Dim non-matching explorer rows in place and select the best hit
	function applyExplorerHighlight(scores, keepSelection) {
		var bestIndex = -1;
		var bestScore = 0;
		var hitCount = 0;
		$("#omni-extension #omni-list .omni-item").each(function() {
			var index = parseInt($(this).attr("data-index"), 10);
			var hit = scores[index] > 0;
			$(this).toggleClass("omni-dim", !hit);
			if (hit) {
				hitCount++;
				// Ties go to tabs you are not already on
				var rankScore = scores[index] + (actions[index] && !actions[index].currentTab ? 0.5 : 0);
				if (rankScore > bestScore) {
					bestScore = rankScore;
					bestIndex = index;
				}
			}
		});
		$(".omni-extension #omni-results").html(hitCount + " of " + actions.length + " tabs");
		if (!keepSelection && bestIndex > -1) {
			activateElement($("#omni-extension #omni-list .omni-item[data-index='" + bestIndex + "']"));
		}
	}

	// No-match fallback: sections fill in asynchronously as they arrive
	var fallbackState = null;
	function rebuildFallback() {
		if (!fallbackState) {
			return;
		}
		actions = fallbackState.bookmarks.concat(fallbackState.suggestions).concat(fallbackState.handoffs);
		populateOmni();
	}

	// Debounced omnibox-style suggestions (Google suggest + history)
	var suggestTimer = null;
	function requestSuggestions(query, callback) {
		window.clearTimeout(suggestTimer);
		suggestTimer = window.setTimeout(() => {
			chrome.runtime.sendMessage({request:"get-suggestions", query:query}, (response) => {
				callback((response && response.actions) || []);
			});
		}, 120);
	}

	// Search for an action in the omni
	function search(e) {
		if (e.keyCode == 37 || e.keyCode == 38 || e.keyCode == 39 || e.keyCode == 40 || e.keyCode == 13 || e.keyCode == 37) {
			return;
		}
		var value = $(this).val().toLowerCase();
		// Typing ends the entrance stagger so re-renders don't replay it
		$("#omni-extension").removeClass("omni-entering");
		if (isRecentLike()) {
			recentQuery = value.trim();
			updateRecentFilterVisibility();
			if (value.trim() == "") {
				fallbackState = null;
				actions = recentActions.slice();
				populateOmni();
				return;
			}
			if (isExplorerFlow()) {
				// Explorer flow keeps every tab visible in place: matches
				// stay crisp and get selected, everything else dims
				var explorerScores = recentActions.map((recentAction) => scoreRecentAction(recentAction, value));
				if (explorerScores.some((score) => score > 0)) {
					fallbackState = null;
					actions = recentActions.slice();
					populateOmni();
					applyExplorerHighlight(explorerScores, false);
					return;
				}
				actions = [];
			} else {
				actions = buildRecentMatches(value);
			}
			if (actions.length) {
				// Local matches lead; live suggestions follow as a section
				fallbackState = null;
				var localActions = actions;
				var suggestQuery = value.trim();
				requestSuggestions(suggestQuery, (rows) => {
					if (!isRecentLike() || isExplorerFlow() || fallbackState || recentQuery != suggestQuery || !rows.length) {
						return;
					}
					rows.forEach((row) => { row.section = "Suggestions"; });
					var activeIndex = $(".omni-item-active").attr("data-index");
					actions = localActions.concat(rows);
					populateOmni();
					// Keep whatever was selected: local rows keep their indexes
					if (activeIndex != null) {
						activateElement($("#omni-extension #omni-list .omni-item[data-index='" + activeIndex + "']"));
					}
				});
			}
			if (!actions.length) {
				// Nothing matched — offer web/AI handoffs as fallback results,
				// and pull in matching bookmarks as their own section
				var fallbackQuery = value.trim();
				var encodedQuery = encodeURIComponent(fallbackQuery);
				var handoffActions = [
					{
						title: 'Search Google for "' + fallbackQuery + '"',
						desc: "Press Enter to open the results in a new tab",
						favIconUrl: chrome.runtime.getURL("assets/icon-google.svg"),
						emoji: false,
						url: "https://www.google.com/search?q=" + encodedQuery
					},
					{
						title: 'Ask Gemini "' + fallbackQuery + '"',
						desc: "Press Enter to ask Gemini in a new tab",
						favIconUrl: chrome.runtime.getURL("assets/icon-gemini.svg"),
						emoji: false,
						url: "https://gemini.google.com/app?q=" + encodedQuery
					},
					{
						title: 'Ask Claude "' + fallbackQuery + '"',
						desc: "Press Enter to ask Claude in a new tab",
						emoji: true,
						emojiChar: "✳️",
						url: "https://claude.ai/new?q=" + encodedQuery
					}
				].map((item) => {
					item.type = "search";
					item.action = "search-handoff";
					item.section = "Search with";
					item.keycheck = false;
					item.currentTab = false;
					return item;
				});
				// The fallback composes three async-filled sections:
				// Bookmarks, live Suggestions, and the search handoffs
				fallbackState = {query: fallbackQuery, bookmarks: [], suggestions: [], handoffs: handoffActions};
				rebuildFallback();
				chrome.runtime.sendMessage({request:"search-bookmarks", query:fallbackQuery}, (response) => {
					if (!fallbackState || fallbackState.query != fallbackQuery || recentQuery != fallbackQuery) {
						return;
					}
					fallbackState.bookmarks = ((response && response.bookmarks) || [])
						.filter((bookmark) => bookmark.url)
						.map((bookmark) => {
							bookmark.desc = bookmark.desc || bookmark.url;
							bookmark.section = "Bookmarks";
							bookmark.currentTab = false;
							bookmark.keycheck = false;
							return bookmark;
						})
						.sort((a, b) => scoreRecentAction(b, fallbackQuery) - scoreRecentAction(a, fallbackQuery))
						.slice(0, 6);
					rebuildFallback();
				});
				requestSuggestions(fallbackQuery, (rows) => {
					if (!fallbackState || fallbackState.query != fallbackQuery || recentQuery != fallbackQuery) {
						return;
					}
					rows.forEach((row) => { row.section = "Suggestions"; });
					fallbackState.suggestions = rows;
					rebuildFallback();
				});
				return;
			}
			populateOmni();
			return;
		}
		checkShortHand(e, value);
		value = $(this).val().toLowerCase();
		if (value.startsWith("/history")) {
			$(".omni-item[data-index='"+actions.findIndex(x => x.action == "search")+"']").hide();
			$(".omni-item[data-index='"+actions.findIndex(x => x.action == "goto")+"']").hide();
			var tempvalue = value.replace("/history ", "");
			var query = "";
			if (tempvalue != "/history") {
				query = value.replace("/history ", "");
			}
			chrome.runtime.sendMessage({request:"search-history", query:query}, (response) => {
				populateOmniFilter(response.history);
			});
		} else if (value.startsWith("/bookmarks")) {
			$(".omni-item[data-index='"+actions.findIndex(x => x.action == "search")+"']").hide();
			$(".omni-item[data-index='"+actions.findIndex(x => x.action == "goto")+"']").hide();
			var tempvalue = value.replace("/bookmarks ", "");
			if (tempvalue != "/bookmarks" && tempvalue != "") {
				var query = value.replace("/bookmarks ", "");
				chrome.runtime.sendMessage({request:"search-bookmarks", query:query}, (response) => {
					populateOmniFilter(response.bookmarks);
				});
			} else {
				populateOmniFilter(actions.filter(x => x.type == "bookmark"));
			}
		} else {
			if (isFiltered) {
				populateOmni();
				isFiltered = false;
			}
			$(".omni-extension #omni-list .omni-item").filter(function(){
				if (value.startsWith("/tabs")) {
					$(".omni-item[data-index='"+actions.findIndex(x => x.action == "search")+"']").hide();
					$(".omni-item[data-index='"+actions.findIndex(x => x.action == "goto")+"']").hide();
					var tempvalue = value.replace("/tabs ", "");
					if (tempvalue == "/tabs") {
						$(this).toggle($(this).attr("data-type") == "tab");
					} else {
						tempvalue = value.replace("/tabs ", "");
						$(this).toggle(($(this).find(".omni-item-name").text().toLowerCase().indexOf(tempvalue) > -1 || $(this).find(".omni-item-desc").text().toLowerCase().indexOf(tempvalue) > -1) && $(this).attr("data-type") == "tab");
					}
				} else if (value.startsWith("/remove")) {
					$(".omni-item[data-index='"+actions.findIndex(x => x.action == "search")+"']").hide();
					$(".omni-item[data-index='"+actions.findIndex(x => x.action == "goto")+"']").hide();
					var tempvalue = value.replace("/remove ", "")
					if (tempvalue == "/remove") {
						$(this).toggle($(this).attr("data-type") == "bookmark" || $(this).attr("data-type") == "tab");
					} else {
						tempvalue = value.replace("/remove ", "");
						$(this).toggle(($(this).find(".omni-item-name").text().toLowerCase().indexOf(tempvalue) > -1 || $(this).find(".omni-item-desc").text().toLowerCase().indexOf(tempvalue) > -1) && ($(this).attr("data-type") == "bookmark" || $(this).attr("data-type") == "tab"));
					}
				} else if (value.startsWith("/actions")) {
					$(".omni-item[data-index='"+actions.findIndex(x => x.action == "search")+"']").hide();
					$(".omni-item[data-index='"+actions.findIndex(x => x.action == "goto")+"']").hide();
					var tempvalue = value.replace("/actions ", "")
					if (tempvalue == "/actions") {
						$(this).toggle($(this).attr("data-type") == "action");
					} else {
						tempvalue = value.replace("/actions ", "");
						$(this).toggle(($(this).find(".omni-item-name").text().toLowerCase().indexOf(tempvalue) > -1 || $(this).find(".omni-item-desc").text().toLowerCase().indexOf(tempvalue) > -1) && $(this).attr("data-type") == "action");
					}
				} else {
					$(this).toggle($(this).find(".omni-item-name").text().toLowerCase().indexOf(value) > -1 || $(this).find(".omni-item-desc").text().toLowerCase().indexOf(value) > -1);
					if (value == "") {
						$(".omni-item[data-index='"+actions.findIndex(x => x.action == "search")+"']").hide();
						$(".omni-item[data-index='"+actions.findIndex(x => x.action == "goto")+"']").hide();
					} else if (!validURL(value)) {
						$(".omni-item[data-index='"+actions.findIndex(x => x.action == "search")+"']").show();
						$(".omni-item[data-index='"+actions.findIndex(x => x.action == "goto")+"']").hide();
						$(".omni-item[data-index='"+actions.findIndex(x => x.action == "search")+"'] .omni-item-name").html('\"'+value+'\"');
					} else {
						$(".omni-item[data-index='"+actions.findIndex(x => x.action == "search")+"']").hide();
						$(".omni-item[data-index='"+actions.findIndex(x => x.action == "goto")+"']").show();
						$(".omni-item[data-index='"+actions.findIndex(x => x.action == "goto")+"'] .omni-item-name").html(value);
					}
				}
			});
		}
		
		$(".omni-extension #omni-results").html($("#omni-extension #omni-list .omni-item:visible").length+" results");
			setDefaultActiveItem();
		}

	// Handle actions from the omni
	function handleAction(e) {
		var activeItem = $(this).hasClass("omni-item") ? $(this) : $(".omni-item-active");
		if (activeItem.length) {
			activateElement(activeItem);
		}
		var action = actions[activeItem.attr("data-index")];
		if (action && action.type == "action") {
			chrome.runtime.sendMessage({request:"record-recent-action", action:action});
		}
		closeOmni(true);
		if (action && window.location.href == chrome.runtime.getURL("newtab.html") && (action.action == "switch-tab" || action.action == "search-handoff")) {
			// The destination lives in another tab — this placeholder tab
			// would otherwise linger; close it once the action is sent
			window.setTimeout(() => {
				chrome.runtime.sendMessage({request:"close-new-tab"});
			}, 50);
		}
		if ($(".omni-extension input").val().toLowerCase().startsWith("/remove")) {
			chrome.runtime.sendMessage({request:"remove", type:action.type, action:action});
		} else if ($(".omni-extension input").val().toLowerCase().startsWith("/history")) {
			if (e.ctrlKey || e.metaKey) {
				window.open($(".omni-item-active").attr("data-url"));
			} else {
				window.open($(".omni-item-active").attr("data-url"), "_self");
			}
		} else if ($(".omni-extension input").val().toLowerCase().startsWith("/bookmarks")) {
			if (e.ctrlKey || e.metaKey) {
				window.open($(".omni-item-active").attr("data-url"));
			} else {
				window.open($(".omni-item-active").attr("data-url"), "_self");
			}
		} else {
			chrome.runtime.sendMessage({request:action.action, tab:action, query:$(".omni-extension input").val()});
			switch (action.action) {
				case "bookmark":
					if (e.ctrlKey || e.metaKey) {
						window.open(action.url);
					} else {
						window.open(action.url, "_self");
					}
					break;
				case "scroll-bottom":
					window.scrollTo(0,document.body.scrollHeight);
					showToast(action);
					break;
				case "scroll-top":
					window.scrollTo(0,0);
					break;
				case "navigation":
					if (e.ctrlKey || e.metaKey) {
						window.open(action.url);
					} else {
						window.open(action.url, "_self");
					}
					break;
				case "fullscreen":
					var elem = document.documentElement;
					elem.requestFullscreen();
					break;
				case "new-tab":
					window.open("");
					break;
				case "search-handoff":
					window.open(action.url);
					break;
				case "email":
					window.open("mailto:");
					break;
				case "url":
					if (e.ctrlKey || e.metaKey) {
						window.open(action.url);
					} else {
						window.open(action.url, "_self");
					}
					break;
				case "goto":
					if (e.ctrlKey || e.metaKey) {
						window.open(addhttp($(".omni-extension input").val()));
					} else {
						window.open(addhttp($(".omni-extension input").val()), "_self");
					}
					break;
				case "print":
					window.print();
					break;
				case "remove-all":
				case "remove-history":
				case "remove-cookies":
				case "remove-cache":
				case "remove-local-storage":
				case "remove-passwords":
					showToast(action);
					break;
			}
		}

		// Fetch actions again
		chrome.runtime.sendMessage({request:"get-actions"}, (response) => {
			if (currentMode == "default") {
				actions = response.actions;
				populateOmni();
			}
		});
	}

	// Customize the shortcut to open the Omni box
	function openShortcuts() {
		chrome.runtime.sendMessage({request:"extensions/shortcuts"});
	}

	function moveResultSelection(direction) {
		var activeItem = $(".omni-item-active");
		if (!activeItem.length) {
			setDefaultActiveItem();
			return;
		}
		var sibling = direction < 0 ? activeItem.prevAll(".omni-item:visible").first() : activeItem.nextAll(".omni-item:visible").first();
		if (sibling.length) {
			activateElement(sibling);
		}
	}

	function moveShortcutSelection(direction) {
		var activeShortcut = $(".omni-shortcut-item-active");
		if (!activeShortcut.length) {
			activateElement($("#omni-shortcuts .omni-shortcut-item").first());
			return;
		}
		var sibling = direction < 0 ? activeShortcut.prevAll(".omni-shortcut-item").first() : activeShortcut.nextAll(".omni-shortcut-item").first();
		if (sibling.length) {
			activateElement(sibling);
		}
	}

	function moveAcrossColumns(toShortcuts) {
		if (currentMode != "recent") {
			return;
		}
		if (toShortcuts) {
			var firstShortcut = $("#omni-shortcuts .omni-shortcut-item").first();
			if (firstShortcut.length) {
				activateElement(firstShortcut);
			}
		} else {
			setDefaultActiveItem();
		}
	}


	// Capture phase on window: runs before the page's own handlers, so the
	// omni owns the keyboard while it is open even on sites with global
	// key handling, and stray keystrokes are pulled back into its input
	window.addEventListener("keydown", (e) => {
		// Global Alt+Shift shortcuts (work whether or not the omni is open)
		if (e.altKey && e.shiftKey && !e.repeat) {
			if (e.keyCode == 80) {
				// Alt+Shift+P: pin/unpin tab
				if (actions.find(x => x.action == "pin") != undefined) {
					chrome.runtime.sendMessage({request:"pin-tab"});
				} else {
					chrome.runtime.sendMessage({request:"unpin-tab"});
				}
				chrome.runtime.sendMessage({request:"get-actions"}, (response) => {
					actions = response.actions;
					populateOmni();
				});
				return;
			} else if (e.keyCode == 77) {
				// Alt+Shift+M: mute/unmute tab
				if (actions.find(x => x.action == "mute") != undefined) {
					chrome.runtime.sendMessage({request:"mute-tab"});
				} else {
					chrome.runtime.sendMessage({request:"unmute-tab"});
				}
				chrome.runtime.sendMessage({request:"get-actions"}, (response) => {
					actions = response.actions;
					populateOmni();
				});
				return;
			} else if (e.keyCode == 67) {
				// Alt+Shift+C: compose email
				window.open("mailto:");
				return;
			}
		}

		if (!isOpen) {
			return;
		}

		// The page must not react to keys while the omni is open
		e.stopPropagation();

		// Cmd/Ctrl+Backspace closes the selected tab, palette stays open
		if ((e.metaKey || e.ctrlKey) && (e.key == "Backspace" || e.keyCode == 8)) {
			e.preventDefault();
			closeActiveTabRow();
			return;
		}

		// If the page kept or stole focus, pull the keystroke into the omni
		// input: refocusing during keydown makes the character land there
		var input = $("#omni-extension input").get(0);
		var printable = e.key && e.key.length == 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
		if (input && (printable || (e.key == "Backspace" && !e.metaKey && !e.ctrlKey)) && document.activeElement !== input) {
			input.focus();
			return;
		}

		if (e.key == "ArrowUp" || e.keyCode == 38) {
			// Up key
			e.preventDefault();
			if (currentMode == "recent" && $(".omni-shortcut-item-active").length) {
				moveShortcutSelection(-1);
			} else {
				moveResultSelection(-1);
			}
		} else if (e.key == "ArrowDown" || e.keyCode == 40) {
			// Down key
			e.preventDefault();
			if (currentMode == "recent" && $(".omni-shortcut-item-active").length) {
				moveShortcutSelection(1);
			} else {
				moveResultSelection(1);
			}
		} else if (e.key == "ArrowLeft" || e.key == "ArrowRight" || e.keyCode == 37 || e.keyCode == 39) {
			// Left/right switch columns in recent mode; elsewhere the caret keeps them
			if (currentMode == "recent") {
				e.preventDefault();
				moveAcrossColumns(e.key == "ArrowLeft" || e.keyCode == 37);
			}
		} else if (e.key == "Tab" || e.keyCode == 9) {
			// Tab: keep focus where it is
			e.preventDefault();
		} else if (e.key == "Escape" || e.keyCode == 27) {
			// Esc key
			e.preventDefault();
			closeOmni();
		} else if (e.key == "Enter" || e.keyCode == 13) {
			// Enter key
			e.preventDefault();
			if ($(".omni-shortcut-item-active").length) {
				handleShortcutAction(e);
			} else {
				handleAction(e);
			}
		}
	}, true);

	// Keep keypress/keyup from the page too while the omni is open
	window.addEventListener("keypress", (e) => {
		if (isOpen) {
			e.stopPropagation();
		}
	}, true);
	window.addEventListener("keyup", (e) => {
		if (isOpen) {
			e.stopPropagation();
		}
	}, true);

	// Recieve messages from background
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message.request == "open-omni") {
			if (isOpen) {
				closeOmni();
			} else {
				openOmni("default");
			}
		} else if (message.request == "open-recents") {
			if (isOpen && currentMode == "recent") {
				closeOmni();
			} else {
				openOmni("recent");
			}
		} else if (message.request == "open-explorer") {
			if (isOpen && currentMode == "explorer") {
				closeOmni();
			} else {
				openOmni("explorer");
			}
		} else if (message.request == "close-omni") {
			closeOmni();
		}
	});

	$(document).on("click", "#open-page-omni-extension-thing", openShortcuts);
	$(document).on("mouseover", ".omni-extension .omni-item:not(.omni-item-active)", hoverItem);
	$(document).on("mouseover", ".omni-shortcut-item:not(.omni-shortcut-item-active)", hoverShortcutItem);
	// "input" fires for every value change, including ones with no keyup (IME, dictation, paste)
	$(document).on("input", ".omni-extension input", search);
	$(document).on("click", ".omni-extension .omni-close-tab", function(e) {
		e.stopPropagation();
		closeTabRow($(this).closest(".omni-item"));
	});
	$(document).on("change", "#omni-flow-checkbox", function() {
		paletteExplorerFlow = this.checked;
		chrome.storage.local.set({leapPaletteExplorerFlow: paletteExplorerFlow});
		if (isOpen && currentMode == "recent") {
			// Reopen so the list is refetched with the newly chosen flow
			openOmni("recent");
		}
	});
	$(document).on("click", ".omni-item", handleAction);
	$(document).on("click", ".omni-shortcut-item", handleShortcutAction);
	$(document).on("click", ".omni-extension #omni-overlay", closeOmni);
});
