let actions = [];
let newtaburl = "";
let launchMode = "default";
const RECENT_ITEMS_KEY = "omniRecentItems";
const RECENT_ITEMS_LIMIT = 25;

// Chrome's local favicon cache: instant, works for unloaded tabs and pages
// whose favicon can't be hotlinked (auth walls, bot protection, page CSP)
const faviconForUrl = (url) => {
	return chrome.runtime.getURL("/_favicon/?pageUrl=" + encodeURIComponent(url) + "&size=64");
}

// Clean display name for a URL: the domain without protocol, www, or path
const prettyHost = (url) => {
	try {
		const u = new URL(url);
		if (u.protocol === "http:" || u.protocol === "https:") {
			return u.hostname.replace(/^www\./, "");
		}
		return (u.protocol + "//" + (u.hostname || u.pathname.split("/")[0])).replace(/\/$/, "");
	} catch (e) {
		return url;
	}
}

const canOpenOmniInTab = (tab) => {
	return tab && tab.url && !tab.url.includes("chrome://") && !tab.url.includes("chrome.google.com");
}

const canTrackTab = (tab) => {
	return tab && tab.id && tab.url && !tab.url.includes("chrome://") && !tab.url.includes("chrome-extension://") && !tab.url.includes("chrome.google.com");
}

// The recents list lives in memory and is persisted on a short debounce.
// Reading, modifying and writing storage per switch lost updates: switching
// tabs quickly ran several of those concurrently and each wrote back a
// snapshot taken before the others had landed.
let recentItemsCache = null;
let recentItemsLoad = null;
let recentSaveTimer = null;
let recentSaveSince = 0;

const getRecentItems = async () => {
	if (recentItemsCache) {
		return recentItemsCache;
	}
	if (!recentItemsLoad) {
		recentItemsLoad = chrome.storage.local.get(RECENT_ITEMS_KEY).then((data) => {
			recentItemsCache = (data && data[RECENT_ITEMS_KEY]) || [];
			return recentItemsCache;
		});
	}
	return recentItemsLoad;
}

const writeRecentItems = () => {
	recentSaveTimer = null;
	recentSaveSince = 0;
	if (recentItemsCache) {
		chrome.storage.local.set({[RECENT_ITEMS_KEY]: recentItemsCache});
	}
}

const saveRecentItems = () => {
	const now = Date.now();
	if (!recentSaveSince) {
		recentSaveSince = now;
	}
	clearTimeout(recentSaveTimer);
	// Coalesce bursts of switching, but never hold a write back for long
	recentSaveTimer = setTimeout(writeRecentItems, now - recentSaveSince > 1500 ? 0 : 400);
}

const pushRecentItem = async (item) => {
	if (!item || !item.key) {
		return;
	}
	await getRecentItems();
	// Rewriting the in-memory list happens in one synchronous step, so
	// concurrent switches queue behind each other instead of colliding
	recentItemsCache = [{...item, timestamp: Date.now()}]
		.concat(recentItemsCache.filter((recentItem) => recentItem.key !== item.key))
		.slice(0, RECENT_ITEMS_LIMIT);
	saveRecentItems();
}

const trackRecentTab = async (tab) => {
	if (!canTrackTab(tab)) {
		return;
	}
	await pushRecentItem({
		key: "tab:" + tab.id,
		kind: "tab",
		tabId: tab.id,
		url: tab.url,
		title: tab.title || tab.url
	});
}

const trackRecentAction = async (action) => {
	if (!action || action.type !== "action" || !action.action || action.action === "search" || action.action === "goto") {
		return;
	}
	await pushRecentItem({
		key: "action:" + action.action + ":" + (action.url || ""),
		kind: "action",
		action: action
	});
}

const getRecentActions = async () => {
	const [recentItems, tabs, currentTab] = await Promise.all([getRecentItems(), chrome.tabs.query({}), getCurrentTab()]);
	const trackedTimestamps = new Map();
	recentItems.forEach((item) => {
		if (item.kind === "tab") {
			trackedTimestamps.set(item.tabId, item.timestamp || 0);
		}
	});
	const recentTabs = tabs
		.filter((tab) => canTrackTab(tab) && (!currentTab || tab.id !== currentTab.id))
		.sort((a, b) => {
			const aRecent = trackedTimestamps.get(a.id) || a.lastAccessed || 0;
			const bRecent = trackedTimestamps.get(b.id) || b.lastAccessed || 0;
			return bRecent - aRecent;
		})
		.map((tab) => {
			return {
				title: tab.title || tab.url,
				desc: prettyHost(tab.url),
				type: "tab",
				action: "switch-tab",
				id: tab.id,
				index: tab.index,
				windowId: tab.windowId,
				url: tab.url,
				favIconUrl: faviconForUrl(tab.url),
				emoji: false,
				emojiChar: "🗂",
				keycheck: false,
				currentTab: false
			};
		});
	if (canTrackTab(currentTab)) {
		recentTabs.unshift({
			title: currentTab.title || currentTab.url,
			desc: "Current tab • " + prettyHost(currentTab.url),
			type: "tab",
			action: "switch-tab",
			id: currentTab.id,
			index: currentTab.index,
			windowId: currentTab.windowId,
			url: currentTab.url,
			favIconUrl: faviconForUrl(currentTab.url),
			emoji: false,
			emojiChar: "🗂",
			keycheck: false,
			currentTab: true
		});
	}
	return recentTabs;
}

// All open tabs in tab-strip order (current window first) for the explorer drawer
const getExplorerTabs = async () => {
	const [tabs, currentTab, recentItems] = await Promise.all([chrome.tabs.query({}), getCurrentTab(), getRecentItems()]);
	const currentWindowId = currentTab ? currentTab.windowId : null;
	const trackedTimestamps = new Map();
	recentItems.forEach((item) => {
		if (item.kind === "tab") {
			trackedTimestamps.set(item.tabId, item.timestamp || 0);
		}
	});
	const sorted = tabs
		.filter((tab) => tab.id && tab.url)
		.sort((a, b) => {
			if (a.windowId !== b.windowId) {
				if (a.windowId === currentWindowId) return -1;
				if (b.windowId === currentWindowId) return 1;
				return a.windowId - b.windowId;
			}
			return a.index - b.index;
		});
	// Group headers only when tabs span several windows
	const windowLabels = new Map();
	sorted.forEach((tab) => {
		if (!windowLabels.has(tab.windowId)) {
			windowLabels.set(tab.windowId, tab.windowId === currentWindowId ? "This window" : "Window " + (windowLabels.size + (windowLabels.has(currentWindowId) ? 0 : 1)));
		}
	});
	const useSections = windowLabels.size > 1;
	return sorted
		.map((tab) => {
			const isCurrent = currentTab && tab.id === currentTab.id;
			return {
				section: useSections ? windowLabels.get(tab.windowId) : undefined,
				lastActive: trackedTimestamps.get(tab.id) || tab.lastAccessed || 0,
				title: tab.title || tab.url,
				desc: (isCurrent ? "Current tab • " : "") + prettyHost(tab.url),
				type: "tab",
				action: "switch-tab",
				id: tab.id,
				index: tab.index,
				windowId: tab.windowId,
				url: tab.url,
				favIconUrl: faviconForUrl(tab.url),
				emoji: false,
				emojiChar: "🗂",
				keycheck: false,
				currentTab: !!isCurrent
			};
		});
}

// Live omnibox-style suggestions: Google suggest (same source Chrome uses)
// plus history URL matches, returned as ready-to-render action rows
const fetchGoogleSuggestions = async (query) => {
	const res = await fetch(
		"https://suggestqueries.google.com/complete/search?client=chrome&q=" + encodeURIComponent(query),
		{ signal: AbortSignal.timeout(900) }
	);
	const data = await res.json();
	const texts = data[1] || [];
	const meta = data[4] || {};
	const types = meta["google:suggesttype"] || [];
	const details = meta["google:suggestdetail"] || [];
	return texts.slice(0, 5).map((text, i) => ({ text: text, type: types[i] || "QUERY", detail: details[i] }));
}

const getSuggestions = async (query) => {
	const [suggestions, historyItems] = await Promise.all([
		fetchGoogleSuggestions(query).catch(() => []),
		chrome.history.search({ text: query, maxResults: 4 }).catch(() => [])
	]);
	const rows = [];
	const seenUrls = new Set();
	suggestions.forEach((s) => {
		if (s.type === "NAVIGATION") {
			const url = /^https?:\/\//.test(s.text) ? s.text : "https://" + s.text;
			if (seenUrls.has(url)) return;
			seenUrls.add(url);
			rows.push({
				title: s.text.replace(/^https?:\/\//, ""),
				desc: prettyHost(url),
				type: "history",
				action: "search-handoff",
				url: url,
				favIconUrl: faviconForUrl(url),
				emoji: false,
				keycheck: false,
				currentTab: false
			});
		} else {
			rows.push({
				title: s.text,
				desc: (s.detail && s.detail.a) ? s.detail.a : "Google Search",
				type: "search",
				action: "search-handoff",
				url: "https://www.google.com/search?q=" + encodeURIComponent(s.text),
				emoji: true,
				emojiChar: "🔍",
				keycheck: false,
				currentTab: false
			});
		}
	});
	historyItems.forEach((item) => {
		if (!item.url || seenUrls.has(item.url) || rows.length >= 8) {
			return;
		}
		seenUrls.add(item.url);
		rows.push({
			title: item.title || prettyHost(item.url),
			desc: prettyHost(item.url),
			type: "history",
			action: "search-handoff",
			url: item.url,
			favIconUrl: faviconForUrl(item.url),
			emoji: false,
			keycheck: false,
			currentTab: false
		});
	});
	return rows;
}

// Clear actions and append default ones
const buildBaseActions = (response) => {
	{
		let actions = [];
		const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
		let muteaction = {title:"Mute tab", desc:"Mute the current tab", type:"action", action:"mute", emoji:true, emojiChar:"🔇", keycheck:true, keys:['⌥','⇧', 'M']};
		let pinaction = {title:"Pin tab", desc:"Pin the current tab", type:"action", action:"pin", emoji:true, emojiChar:"📌", keycheck:true, keys:['⌥','⇧', 'P']};
		if (response.mutedInfo.muted) {
			muteaction = {title:"Unmute tab", desc:"Unmute the current tab", type:"action", action:"unmute", emoji:true, emojiChar:"🔈", keycheck:true, keys:['⌥','⇧', 'M']};
		}
		if (response.pinned) {
			pinaction = {title:"Unpin tab", desc:"Unpin the current tab", type:"action", action:"unpin", emoji:true, emojiChar:"📌", keycheck:true, keys:['⌥','⇧', 'P']};
		}
		actions = [
			{title:"New tab", desc:"Open a new tab", type:"action", action:"new-tab", emoji:true, emojiChar:"✨", keycheck:true, keys:['⌘','T']},
			{title:"Bookmark", desc:"Create a bookmark", type:"action", action:"create-bookmark", emoji:true, emojiChar:"📕", keycheck:true, keys:['⌘','D']},
			pinaction,
			{title:"Fullscreen", desc:"Make the page fullscreen", type:"action", action:"fullscreen", emoji:true, emojiChar:"🖥", keycheck:true, keys:['⌘', 'Ctrl', 'F']},
			muteaction,
			{title:"Reload", desc:"Reload the page", type:"action", action:"reload", emoji:true, emojiChar:"♻️", keycheck:true, keys:['⌘','⇧', 'R']},
			{title:"Change theme", desc:"Pick a look for Leap", type:"action", action:"open-options", emoji:true, emojiChar:"🎨", keycheck:false},
			{title:"Help", desc:"Get help with Leap on GitHub", type:"action", action:"url", url:"https://github.com/tharshikan/omni", emoji:true, emojiChar:"🤔", keycheck:false},
			{title:"Compose email", desc:"Compose a new email", type:"action", action:"email", emoji:true, emojiChar:"✉️", keycheck:true, keys:['⌥','⇧', 'C']},
			{title:"Print page", desc:"Print the current page", type:"action", action:"print", emoji:true, emojiChar:"🖨️", keycheck:true, keys:['⌘', 'P']},
			{title:"New Notion page", desc:"Create a new Notion page", type:"action", action:"url", url:"https://notion.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-notion.png"), keycheck:false},
			{title:"New Sheets spreadsheet", desc:"Create a new Google Sheets spreadsheet", type:"action", action:"url", url:"https://sheets.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-sheets.png"), keycheck:false},
			{title:"New Docs document", desc:"Create a new Google Docs document", type:"action", action:"url", emoji:false, url:"https://docs.new", favIconUrl:chrome.runtime.getURL("assets/logo-docs.png"), keycheck:false},
			{title:"New Slides presentation", desc:"Create a new Google Slides presentation", type:"action", action:"url", url:"https://slides.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-slides.png"), keycheck:false},
			{title:"New form", desc:"Create a new Google Forms form", type:"action", action:"url", url:"https://forms.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-forms.png"), keycheck:false},
			{title:"New Medium story", desc:"Create a new Medium story", type:"action", action:"url", url:"https://story.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-medium.png"), keycheck:false},
			{title:"New GitHub repository", desc:"Create a new GitHub repository", type:"action", action:"url", url:"https://github.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-github.png"), keycheck:false},
			{title:"New GitHub gist", desc:"Create a new GitHub gist", type:"action", action:"url", url:"https://gist.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-github.png"), keycheck:false},
			{title:"New CodePen pen", desc:"Create a new CodePen pen", type:"action", action:"url", url:"https://pen.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-codepen.png"), keycheck:false},
			{title:"New Excel spreadsheet", desc:"Create a new Excel spreadsheet", type:"action", action:"url", url:"https://excel.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-excel.png"), keycheck:false},
			{title:"New PowerPoint presentation", desc:"Create a new PowerPoint presentation", type:"action", url:"https://powerpoint.new", action:"url", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-powerpoint.png"), keycheck:false},
			{title:"New Word document", desc:"Create a new Word document", type:"action", action:"url", url:"https://word.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-word.png"), keycheck:false},
			{title:"Create a whiteboard", desc:"Create a collaborative whiteboard", type:"action", action:"url", url:"https://whiteboard.new", emoji:true, emojiChar:"🧑‍🏫", keycheck:false},
			{title:"Record a video", desc:"Record and edit a video", type:"action", action:"url", url:"https://recording.new", emoji:true, emojiChar:"📹", keycheck:false},
			{title:"Create a Figma file", desc:"Create a new Figma file", type:"action", action:"url", url:"https://figma.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-figma.png"), keycheck:false},
			{title:"Create a FigJam file", desc:"Create a new FigJam file", type:"action", action:"url", url:"https://figjam.new", emoji:true, emojiChar:"🖌", keycheck:false},
			{title:"Hunt a product", desc:"Submit a product to Product Hunt", type:"action", action:"url", url:"https://www.producthunt.com/posts/new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-producthunt.png"), keycheck:false},
			{title:"Make a tweet", desc:"Make a tweet on Twitter", type:"action", action:"url", url:"https://twitter.com/intent/tweet", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-twitter.png"), keycheck:false},
			{title:"Create a playlist", desc:"Create a Spotify playlist", type:"action", action:"url", url:"https://playlist.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-spotify.png"), keycheck:false},
			{title:"Create a Canva design", desc:"Create a new design with Canva", type:"action", action:"url", url:"https://design.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-canva.png"), keycheck:false},
			{title:"Create a new podcast episode", desc:"Create a new podcast episode with Anchor", type:"action", action:"url", url:"https://episode.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-anchor.png"), keycheck:false},
			{title:"Edit an image", desc:"Edit an image with Adobe Photoshop", type:"action", action:"url", url:"https://photo.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-photoshop.png"), keycheck:false},
			{title:"Convert to PDF", desc:"Convert a file to PDF", type:"action", action:"url", url:"https://pdf.new", emoji:true, emojiChar:"📄", keycheck:false},
			{title:"Scan a QR code", desc:"Scan a QR code with your camera", type:"action", action:"url", url:"https://scan.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-qr.png"), keycheck:false},
			{title:"Add a task to Asana", desc:"Create a new task in Asana", type:"action", action:"url", url:"https://task.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-asana.png"), keycheck:false},
			{title:"Add an issue to Linear", desc:"Create a new issue in Linear", type:"action", action:"url", url:"https://linear.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-linear.png"), keycheck:false},
			{title:"Add a task to WIP", desc:"Create a new task in WIP", type:"action", action:"url", url:"https://todo.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-wip.png"), keycheck:false},
			{title:"Create an event", desc:"Add an event to Google Calendar", type:"action", action:"url", url:"https://cal.new", emoji:false, favIconUrl:chrome.runtime.getURL("assets/logo-calendar.png"), keycheck:false},
			{title:"Add a note", desc:"Add a note to Google Keep", type:"action", action:"url", emoji:false, url:"https://note.new", favIconUrl:chrome.runtime.getURL("assets/logo-keep.png"), keycheck:false},
			{title:"New meeting", desc:"Start a Google Meet meeting", type:"action", action:"url", emoji:false, url:"https://meet.new", favIconUrl:chrome.runtime.getURL("assets/logo-meet.png"), keycheck:false},
			{title:"Browsing history", desc:"Browse through your browsing history", type:"action", action:"history", emoji:true, emojiChar:"🗂", keycheck:true, keys:['⌘','Y']},
			{title:"Incognito mode", desc:"Open an incognito window", type:"action", action:"incognito", emoji:true, emojiChar:"🕵️", keycheck:true, keys:['⌘','⇧', 'N']},
			{title:"Downloads", desc:"Browse through your downloads", type:"action", action:"downloads", emoji:true, emojiChar:"📦", keycheck:true, keys:['⌘','⇧', 'J']},
			{title:"Extensions", desc:"Manage your Chrome Extensions", type:"action", action:"extensions", emoji:true, emojiChar:"🧩", keycheck:false, keys:['⌘','D']},
			{title:"Chrome settings", desc:"Open the Chrome settings", type:"action", action:"settings", emoji:true, emojiChar:"⚙️", keycheck:true, keys:['⌘',',']},
			{title:"Scroll to bottom", desc:"Scroll to the bottom of the page", type:"action", action:"scroll-bottom", emoji:true, emojiChar:"👇", keycheck:true, keys:['⌘','↓']},
			{title:"Scroll to top", desc:"Scroll to the top of the page", type:"action", action:"scroll-top", emoji:true, emojiChar:"👆", keycheck:true, keys:['⌘','↑']},
			{title:"Go back", desc:"Go back in history for the current tab", type:"action", action:"go-back", emoji:true, emojiChar:"👈",  keycheck:true, keys:['⌘','←']},
			{title:"Go forward", desc:"Go forward in history for the current tab", type:"action", action:"go-forward", emoji:true, emojiChar:"👉", keycheck:true, keys:['⌘','→']},
			{title:"Duplicate tab", desc:"Make a copy of the current tab", type:"action", action:"duplicate-tab", emoji:true, emojiChar:"📋", keycheck:true, keys:['⌥','⇧', 'D']},
			{title:"Close tab", desc:"Close the current tab", type:"action", action:"close-tab", emoji:true, emojiChar:"🗑", keycheck:true, keys:['⌘','W']},
			{title:"Close window", desc:"Close the current window", type:"action", action:"close-window", emoji:true, emojiChar:"💥", keycheck:true, keys:['⌘','⇧', 'W']},
			{title:"Manage browsing data", desc:"Manage your browsing data", type:"action", action:"manage-data", emoji:true, emojiChar:"🔬", keycheck:true, keys:['⌘','⇧', 'Delete']},
			{title:"Clear all browsing data", desc:"Clear all of your browsing data", type:"action", action:"remove-all", emoji:true, emojiChar:"🧹", keycheck:false, keys:['⌘','D']},
			{title:"Clear browsing history", desc:"Clear all of your browsing history", type:"action", action:"remove-history", emoji:true, emojiChar:"🗂", keycheck:false, keys:['⌘','D']},
			{title:"Clear cookies", desc:"Clear all cookies", type:"action", action:"remove-cookies", emoji:true, emojiChar:"🍪", keycheck:false, keys:['⌘','D']},
			{title:"Clear cache", desc:"Clear the cache", type:"action", action:"remove-cache", emoji:true, emojiChar:"🗄", keycheck:false, keys:['⌘','D']},
			{title:"Clear local storage", desc:"Clear the local storage", type:"action", action:"remove-local-storage", emoji:true, emojiChar:"📦", keycheck:false, keys:['⌘','D']},
			{title:"Clear passwords", desc:"Clear all saved passwords", type:"action", action:"remove-passwords", emoji:true, emojiChar:"🔑", keycheck:false, keys:['⌘','D']},
		];

		if (!isMac) {
			for (action of actions) {
				switch (action.action) {
					case "reload":
						action.keys = ['F5'];
						break;
					case "fullscreen":
						action.keys = ['F11'];
						break;
					case "downloads":
						action.keys = ['Ctrl', 'J'];
						break;
					case "settings":
						action.keycheck = false;
						break;
					case "history":
						action.keys = ['Ctrl', 'H'];
						break;
					case "go-back":
						action.keys = ['Alt','←'];
						break;
					case "go-forward":
						action.keys = ['Alt','→']
						break;
					case "scroll-top":
						action.keys = ['Home'];
						break;
					case "scroll-bottom":
						action.keys = ['End'];
						break;
				}
				for (const key in action.keys) {
					if (action.keys[key] === "⌘") {
						action.keys[key] = "Ctrl";
					} else if (action.keys[key] === "⌥") {
						action.keys[key] = "Alt";
					}
				};
			};
		}
		return actions;
	}
}

// Open on install
chrome.runtime.onInstalled.addListener((object) => {
  // Inject Omni on install
  const manifest = chrome.runtime.getManifest();

  const injectIntoTab = (tab) => {
    const scripts = manifest.content_scripts[0].js;
    const s = scripts.length;

    for (let i = 0; i < s; i++) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [scripts[i]],
      });
    }

    chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: [manifest.content_scripts[0].css[0]],
    });
  };

  // Get all windows
  chrome.windows.getAll(
    {
      populate: true,
    },
    (windows) => {
      let currentWindow;
      const w = windows.length;

      for (let i = 0; i < w; i++) {
        currentWindow = windows[i];

        let currentTab;
        const t = currentWindow.tabs.length;

        for (let j = 0; j < t; j++) {
          currentTab = currentWindow.tabs[j];
					if (!currentTab.url.includes("chrome://") && !currentTab.url.includes("chrome-extension://") && !currentTab.url.includes("chrome.google.com")) {
          	injectIntoTab(currentTab);
					}
        }
      }
    }
  );

  if (object.reason === "install") {
    chrome.tabs.create({ url: "https://github.com/tharshikan/omni" });
  }
});

// Check when the extension button is clicked
chrome.action.onClicked.addListener((tab) => {
	chrome.tabs.sendMessage(tab.id, {request: "open-omni"});
});

// Listen for the open omni shortcut
chrome.commands.onCommand.addListener((command) => {
	if (command !== "open-omni" && command !== "open-recents" && command !== "open-explorer") {
		return;
	}
	const request = command;
	launchMode = command === "open-recents" ? "recent" : command === "open-explorer" ? "explorer" : "default";
	getCurrentTab().then((response) => {
		if (canOpenOmniInTab(response)) {
			chrome.tabs.sendMessage(response.id, {request: request});
		} else {
			chrome.tabs.create({
				url: "./newtab.html"
			}).then(() => {
				newtaburl = response.url;
				chrome.tabs.remove(response.id);
			})
		}
	});
});

// Get the current tab
const getCurrentTab = async () => {
	const queryOptions = { active: true, currentWindow: true };
	const [tab] = await chrome.tabs.query(queryOptions);
	return tab;
}

// Restore the new tab page (workaround to show Omni in new tab page)
function restoreNewTab() {
	getCurrentTab().then((response) => {
		// newtaburl can be lost when the service worker restarts, fall back to a regular new tab
		const createOptions = newtaburl ? {url: newtaburl} : {};
		chrome.tabs.create(createOptions).then(() => {
			chrome.tabs.remove(response.id);
		})
	})
}

// One deterministic build. The old version kicked off three async builders
// and concatenated synchronously, so whichever resolved last decided the
// contents — tabs or bookmarks could be wiped and the search rows always
// were. Nothing is built until something actually asks for the list.
let actionsDirty = true;
let actionsBuild = null;

const buildActions = async () => {
	const [currentTab, tabs, bookmarks] = await Promise.all([
		getCurrentTab(),
		chrome.tabs.query({}),
		chrome.bookmarks.getRecent(100)
	]);
	const tabActions = tabs.map((tab) => {
		tab.desc = prettyHost(tab.url);
		tab.keycheck = false;
		tab.action = "switch-tab";
		tab.type = "tab";
		if (tab.url) {
			tab.favIconUrl = faviconForUrl(tab.url);
		}
		return tab;
	});
	const bookmarkActions = [];
	const collectBookmarks = (nodes) => {
		for (const bookmark of nodes) {
			if (bookmark.url) {
				bookmarkActions.push({title:bookmark.title, desc:"Bookmark", id:bookmark.id, url:bookmark.url, type:"bookmark", action:"bookmark", emoji:true, emojiChar:"⭐️", keycheck:false});
			}
			if (bookmark.children) {
				collectBookmarks(bookmark.children);
			}
		}
	};
	collectBookmarks(bookmarks);
	const baseActions = buildBaseActions(currentTab || {mutedInfo: {}, pinned: false});
	actions = [
		{title:"Search", desc:"Search for a query", type:"action", action:"search", emoji:true, emojiChar:"🔍", keycheck:false},
		{title:"Search", desc:"Go to website", type:"action", action:"goto", emoji:true, emojiChar:"🔍", keycheck:false}
	].concat(tabActions, baseActions, bookmarkActions);
	actionsDirty = false;
	return actions;
}

// Rebuilds happen on demand, so a burst of tab churn costs a flag flip
// rather than a tabs query and a bookmark scan every couple of hundred ms
const invalidateActions = () => {
	actionsDirty = true;
}

const ensureActions = () => {
	if (!actionsDirty && actions.length) {
		return Promise.resolve(actions);
	}
	if (!actionsBuild) {
		actionsBuild = buildActions().finally(() => {
			actionsBuild = null;
		});
	}
	return actionsBuild;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status === "complete" || changeInfo.title || changeInfo.favIconUrl || changeInfo.pinned !== undefined || changeInfo.mutedInfo) {
		invalidateActions();
	}
});
chrome.tabs.onCreated.addListener((tab) => invalidateActions());
chrome.tabs.onRemoved.addListener((tabId, changeInfo) => invalidateActions());
chrome.bookmarks.onCreated.addListener(invalidateActions);
chrome.bookmarks.onRemoved.addListener(invalidateActions);
chrome.bookmarks.onChanged.addListener(invalidateActions);
chrome.tabs.onActivated.addListener(async (activeInfo) => {
	const tab = await chrome.tabs.get(activeInfo.tabId);
	await trackRecentTab(tab);
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
	if (changeInfo.status === "complete" && tab.active) {
		await trackRecentTab(tab);
	}
});

// Lots of different actions
const switchTab = (tab) => {
	// Select by id — indexes captured when the list was built go stale as
	// tabs open and close (e.g. the newtab.html workaround)
	if (tab.id) {
		chrome.tabs.update(tab.id, { active: true });
	} else {
		chrome.tabs.highlight({
			tabs: tab.index,
			windowId: tab.windowId
		})
	}
	chrome.windows.update(
		tab.windowId,
		{ focused: true }
	)
}
const goBack = (tab) => {
	chrome.tabs.goBack({
		tabs: tab.index
	})
}
const goForward = (tab) => {
	chrome.tabs.goForward({
		tabs: tab.index
	})
}
const duplicateTab = (tab) => {
	getCurrentTab().then((response) => {
		chrome.tabs.duplicate(response.id);
	})
}
const createBookmark = (tab) => {
	getCurrentTab().then((response) => {
		chrome.bookmarks.create({
			title: response.title,
			url: response.url
		});
	})
}
const muteTab = (mute) =>{
	getCurrentTab().then((response) => {
		chrome.tabs.update(response.id, {"muted": mute})
	});
}
const reloadTab = () => {
	chrome.tabs.reload();
}
const pinTab = (pin) => {
	getCurrentTab().then((response) => {
		chrome.tabs.update(response.id, {"pinned": pin})
	});
}
const clearAllData = () => {
	chrome.browsingData.remove({
		"since": (new Date()).getTime()
	}, {
		"appcache": true,
		"cache": true,
		"cacheStorage": true,
		"cookies": true,
		"downloads": true,
		"fileSystems": true,
		"formData": true,
		"history": true,
		"indexedDB": true,
		"localStorage": true,
		"passwords": true,
		"serviceWorkers": true,
		"webSQL": true
	});
}
const clearBrowsingData = () => {
	chrome.browsingData.removeHistory({"since": 0});
}
const clearCookies = () =>{
	chrome.browsingData.removeCookies({"since": 0});
}
const clearCache = () => {
	chrome.browsingData.removeCache({"since": 0});
}
const clearLocalStorage = () => {
	chrome.browsingData.removeLocalStorage({"since": 0});
}
const clearPasswords = () => {
	chrome.browsingData.removePasswords({"since": 0});
}
const openChromeUrl = (url) => {
	chrome.tabs.create({url: 'chrome://'+url+'/'});
}
const openIncognito = () => {
	chrome.windows.create({"incognito": true});
}
const closeWindow = (id) => {
	chrome.windows.remove(id);
}
const closeTab = (tab) => {
	chrome.tabs.remove(tab.id);
}
const closeCurrentTab = () => {
	getCurrentTab().then(closeTab)
}
const removeBookmark = (bookmark) => {
	chrome.bookmarks.remove(bookmark.id);
}

// Receive messages from any tab
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	switch (message.request) {
		case "get-actions":
			ensureActions().then((list) => sendResponse({actions: list}));
			return true;
		case "get-recents":
			getRecentActions().then((recentActions) => {
				sendResponse({actions: recentActions});
			});
			return true;
		case "get-explorer-tabs":
			getExplorerTabs().then((explorerTabs) => {
				sendResponse({actions: explorerTabs});
			});
			return true;
		case "get-launch-mode":
			sendResponse({mode: launchMode});
			launchMode = "default";
			break;
		case "record-recent-action":
			trackRecentAction(message.action);
			break;
		case "switch-tab":
			switchTab(message.tab);
			break;
		case "go-back":
			goBack(message.tab);
			break;
		case "go-forward":
			goForward(message.tab);
			break;
		case "duplicate-tab":
			duplicateTab(message.tab);
			break;
		case "create-bookmark":
			createBookmark(message.tab);
			break;
		case "mute":
			muteTab(true);
			break;
		case "unmute":
			muteTab(false);
			break;
		case "reload":
			reloadTab();
			break;
		case "pin":
			pinTab(true);
			break;
		case "unpin":
			pinTab(false);
			break;
		case "remove-all":
			clearAllData();
			break;
		case "remove-history":
			clearBrowsingData();
			break;
		case "remove-cookies":
			clearCookies();
			break;
		case "remove-cache":
			clearCache();
			break;
		case "remove-local-storage":
			clearLocalStorage();
			break;
		case "remove-passwords":
			clearPasswords();
		case "history": // Fallthrough
		case "downloads":
		case "extensions":
		case "settings":
		case "extensions/shortcuts":
			openChromeUrl(message.request);
			break;
		case "manage-data":
			openChromeUrl("settings/clearBrowserData");
			break;
		case "incognito":
			openIncognito();
			break;
		case "close-window":
			closeWindow(sender.tab.windowId);
			break;
		case "close-tab":
			closeCurrentTab();
			break;
		case "search-history":
			chrome.history.search({text:message.query, maxResults:0, startTime:0}).then((data) => {
				data.forEach((action, index) => {
					action.type = "history";
					action.emoji = true;
					action.emojiChar = "🏛";
					action.action = "history";
					action.keyCheck = false;
				});
				sendResponse({history:data});
			})
			return true;
		case "search-bookmarks":
			chrome.bookmarks.search({query:message.query}).then((data) => {
				// The index property of the bookmark appears to be causing issues, iterating separately...
				data.filter(x => x.index == 0).forEach((action, index) => {
					if (!action.url) {
						data.splice(index, 1);
					}
					action.type = "bookmark";
					if (action.url) {
						action.desc = prettyHost(action.url);
						action.favIconUrl = faviconForUrl(action.url);
						action.emoji = false;
					} else {
						action.emoji = true;
						action.emojiChar = "⭐️";
					}
					action.action = "bookmark";
					action.keyCheck = false;
				})
				data.forEach((action, index) => {
					if (!action.url) {
						data.splice(index, 1);
					}
					action.type = "bookmark";
					if (action.url) {
						action.desc = prettyHost(action.url);
						action.favIconUrl = faviconForUrl(action.url);
						action.emoji = false;
					} else {
						action.emoji = true;
						action.emojiChar = "⭐️";
					}
					action.action = "bookmark";
					action.keyCheck = false;
				})
				sendResponse({bookmarks:data});
			})
			return true;
		case "remove":
			if (message.type == "bookmark") {
				removeBookmark(message.action);
			} else {
				closeTab(message.action);
			}
			break;
		case "search":
			chrome.search.query(
				{text:message.query}
			)
			break;
		case "restore-new-tab":
			restoreNewTab();
			break;
		case "close-new-tab":
			if (sender.tab && sender.tab.id) {
				chrome.tabs.remove(sender.tab.id);
			}
			break;
		case "open-options":
			chrome.runtime.openOptionsPage();
			break;
		case "toggle-pin":
			getCurrentTab().then((tab) => {
				if (tab) {
					chrome.tabs.update(tab.id, {pinned: !tab.pinned});
				}
			});
			break;
		case "toggle-mute":
			getCurrentTab().then((tab) => {
				if (tab) {
					chrome.tabs.update(tab.id, {muted: !(tab.mutedInfo && tab.mutedInfo.muted)});
				}
			});
			break;
		case "get-suggestions":
			getSuggestions(message.query).then((suggestionRows) => {
				sendResponse({actions: suggestionRows});
			});
			return true;
		case "close-omni":
			getCurrentTab().then((response) => {
				chrome.tabs.sendMessage(response.id, {request: "close-omni"});
			});
			break;
		}
});

// One-time theme migration: earlier builds could leave "auto" or the old
// translucent "white" stored, which read grey; move those to Bright White
// once, keeping any deliberately chosen theme
chrome.storage.local.get(["leapTheme", "leapThemeMigrated"]).then((data) => {
	if (data && data.leapThemeMigrated) {
		return;
	}
	const update = { leapThemeMigrated: true };
	if (!data || !data.leapTheme || data.leapTheme === "auto" || data.leapTheme === "white") {
		update.leapTheme = "bright";
	}
	chrome.storage.local.set(update);
});

// Nothing is built at startup: the first request builds the list, so a
// cold service worker answers a shortcut without a tabs query and a
// bookmark scan in front of it
