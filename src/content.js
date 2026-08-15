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

	function updateRecentFilterVisibility() {
		var hasQuery = $("#omni-extension input").val().length > 0;
		$("#omni-extension").toggleClass("omni-recent-mode", currentMode == "recent");
		$("#omni-extension").toggleClass("omni-recent-filtering", currentMode == "recent" && hasQuery);
		$("#omni-recent-query-text").text(recentQuery);
	}

	function updateInputPlaceholder() {
		var placeholder = currentMode == "recent" ? "Search recent tabs and actions" : "Type a command or search";
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
			element[0].scrollIntoView({block:"nearest", inline:"nearest"});
		} else if (element.hasClass("omni-shortcut-item")) {
			element.addClass("omni-shortcut-item-active");
		}
	}

	function setDefaultActiveItem() {
		clearActiveState();
		var visibleItems = $(".omni-extension #omni-list .omni-item:visible");
		if (!visibleItems.length) {
			return;
		}
		if (currentMode == "recent") {
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
		var normalizedTitle = title.replace(/^["'`]+|["'`]+$/g, "");
		var score = 0;
		if (title.startsWith(query)) {
			score += 6;
		} else if (new RegExp("(^|[\\s\\-_\\/])" + query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(title)) {
			score += 5;
		} else if (title.indexOf(query) > -1) {
			score += 3;
		}
		if (desc.indexOf(query) > -1) {
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
		if (currentMode != "recent" || !query) {
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
		var actionTitle = currentMode == "recent" ? highlightRecentMatch(action.title, recentQuery) : escapeHtml(action.title);
		var actionDesc = escapeHtml(action.desc);
		$("#omni-extension #omni-list").append("<div class='omni-item' "+skip+" data-index='"+index+"' data-type='"+action.type+"' data-current-tab='"+(action.currentTab ? "true" : "false")+"'>"+img+"<div class='omni-item-details'><div class='omni-item-name'>"+actionTitle+"</div><div class='omni-item-desc'>"+actionDesc+"</div></div>"+keys+"<div class='omni-select'>Select <span class='omni-shortcut'>⏎</span></div></div>");
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
		actions.forEach((action, index) => {
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
			return $("<div class='omni-item' data-index='"+index+"' data-type='"+action.type+"' data-url='"+action.url+"' data-current-tab='"+(action.currentTab ? "true" : "false")+"'>"+img+"<div class='omni-item-details'><div class='omni-item-name'>"+action.title+"</div><div class='omni-item-desc'>"+action.url+"</div></div>"+keys+"<div class='omni-select'>Select <span class='omni-shortcut'>⏎</span></div></div>")[0]
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

	// Open the omni
	function openOmni(mode) {
		currentMode = mode || "default";
		updateInputPlaceholder();
		const request = currentMode == "recent" ? "get-recents" : "get-actions";
		chrome.runtime.sendMessage({request:request}, (response) => {
			isOpen = true;
			actions = response.actions;
			recentActions = currentMode == "recent" ? response.actions.slice() : [];
			recentQuery = "";
			isFiltered = false;
			$("#omni-extension input").val("");
			updateRecentFilterVisibility();
			// Unhide before populating so setDefaultActiveItem can see the items (:visible)
			$("#omni-extension").removeClass("omni-closing");
			populateOmni();
			$("html, body").stop();
			window.setTimeout(() => {
				$("#omni-extension input").focus();
				focusLock.on($("#omni-extension input").get(0));
				$("#omni-extension input").focus();
			}, 100);
		});
	}

	// Close the omni
	function closeOmni() {
		if (window.location.href == chrome.runtime.getURL("newtab.html")) {
			chrome.runtime.sendMessage({request:"restore-new-tab"});
		} else {
			isOpen = false;
			currentMode = "default";
			recentActions = [];
			recentQuery = "";
			$("#omni-extension input").val("");
			updateRecentFilterVisibility();
			$("#omni-extension").addClass("omni-closing");
		}
	}

	// Hover over an action in the omni
	function hoverItem() {
		activateElement($(this));
	}

	function hoverShortcutItem() {
		activateElement($(this));
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
		closeOmni();
		if (shortcut.request) {
			chrome.runtime.sendMessage({request:shortcut.request});
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
		if (e.keyCode != 8) {
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

	// Search for an action in the omni
	function search(e) {
		if (e.keyCode == 37 || e.keyCode == 38 || e.keyCode == 39 || e.keyCode == 40 || e.keyCode == 13 || e.keyCode == 37) {
			return;
		}
		var value = $(this).val().toLowerCase();
		if (currentMode == "recent") {
			recentQuery = value.trim();
			updateRecentFilterVisibility();
			if (value.trim() == "") {
				actions = recentActions.slice();
				populateOmni();
				return;
			}
			actions = recentActions.map((action, index) => {
				return {
					action: action,
					score: scoreRecentAction(action, value),
					index: index
				};
			}).filter((item) => item.score > 0)
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
		closeOmni();
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


	$(document).keydown((e) => {
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

		if (e.keyCode == 38) {
			// Up key
			if (currentMode == "recent" && $(".omni-shortcut-item-active").length) {
				moveShortcutSelection(-1);
			} else {
				moveResultSelection(-1);
			}
		} else if (e.keyCode == 40) {
			// Down key
			if (currentMode == "recent" && $(".omni-shortcut-item-active").length) {
				moveShortcutSelection(1);
			} else {
				moveResultSelection(1);
			}
		} else if (e.keyCode == 37) {
			moveAcrossColumns(true);
		} else if (e.keyCode == 39) {
			moveAcrossColumns(false);
		} else if (e.keyCode == 27) {
			// Esc key
			closeOmni();
		} else if (e.keyCode == 13) {
			// Enter key
			if ($(".omni-shortcut-item-active").length) {
				handleShortcutAction(e);
			} else {
				handleAction(e);
			}
		}
	});

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
		} else if (message.request == "close-omni") {
			closeOmni();
		}
	});

	$(document).on("click", "#open-page-omni-extension-thing", openShortcuts);
	$(document).on("mouseover", ".omni-extension .omni-item:not(.omni-item-active)", hoverItem);
	$(document).on("mouseover", ".omni-shortcut-item:not(.omni-shortcut-item-active)", hoverShortcutItem);
	$(document).on("keyup", ".omni-extension input", search);
	$(document).on("click", ".omni-item", handleAction);
	$(document).on("click", ".omni-shortcut-item", handleShortcutAction);
	$(document).on("click", ".omni-extension #omni-overlay", closeOmni);
});
