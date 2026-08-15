const THEME_KEY = "leapTheme";
const storage = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local)
	? chrome.storage.local
	: { get: async () => ({}), set: async () => {} };

const grid = document.getElementById("theme-grid");

const autoCard = () => {
	const card = document.createElement("div");
	card.className = "card";
	card.dataset.theme = "auto";
	card.innerHTML =
		'<div class="preview" style="padding:0">' +
			'<div class="auto-split">' +
				'<div class="half" style="left:0;background:#f6f6f8"></div>' +
				'<div class="half" style="right:0;background:#1e1e20"></div>' +
			'</div>' +
		'</div>' +
		'<div class="cardname"><span>Auto (System)</span><span class="tick">✓</span></div>';
	return card;
};

const themeCard = (key, theme) => {
	const v = theme.vars;
	const card = document.createElement("div");
	card.className = "card";
	card.dataset.theme = key;
	card.innerHTML =
		'<div class="preview" style="background:' + v["--panel-solid"] + '">' +
			'<div class="bar" style="background:' + v["--text"] + '"></div>' +
			'<div class="bar b2" style="background:' + v["--text-2"] + '"></div>' +
			'<div class="bar b3" style="background:' + v["--text-3"] + '"></div>' +
			'<div class="chiprow">' +
				'<div class="chip accent" style="background:' + v["--accent"] + '"></div>' +
				'<div class="chip match" style="background:' + v["--match"] + '"></div>' +
			'</div>' +
		'</div>' +
		'<div class="cardname"><span>' + theme.name + '</span><span class="tick">✓</span></div>';
	return card;
};

const select = (key) => {
	document.querySelectorAll(".card").forEach((card) => {
		card.classList.toggle("selected", card.dataset.theme === key);
	});
};

grid.appendChild(autoCard());
Object.keys(LEAP_THEMES).forEach((key) => grid.appendChild(themeCard(key, LEAP_THEMES[key])));

grid.addEventListener("click", (e) => {
	const card = e.target.closest(".card");
	if (!card) return;
	select(card.dataset.theme);
	storage.set({ [THEME_KEY]: card.dataset.theme });
});

storage.get(THEME_KEY).then((data) => {
	var stored = (data && data[THEME_KEY]) || "bright";
	if (stored === "white") {
		stored = "bright";
	}
	select(stored);
});

const SUGGEST_KEY = "leapLiveSuggestions";
const suggestToggle = document.getElementById("live-suggestions");
storage.get(SUGGEST_KEY).then((data) => {
	suggestToggle.checked = !(data && data[SUGGEST_KEY] === false);
});
suggestToggle.addEventListener("change", () => {
	storage.set({ [SUGGEST_KEY]: suggestToggle.checked });
});

const SCALE_KEY = "leapUiScale";
const scaleSlider = document.getElementById("ui-scale");
const scaleValue = document.getElementById("scale-value");
storage.get(SCALE_KEY).then((data) => {
	const percent = Math.round(((data && data[SCALE_KEY]) || 1) * 100);
	scaleSlider.value = percent;
	scaleValue.textContent = percent + "%";
});
scaleSlider.addEventListener("input", () => {
	scaleValue.textContent = scaleSlider.value + "%";
	storage.set({ [SCALE_KEY]: scaleSlider.value / 100 });
});

// Keyboard shortcuts: Chrome owns command bindings, so show the live ones
// and deep-link to Chrome's editor where they can be changed
const COMMAND_LABELS = {
	"open-omni": "Open the command palette",
	"open-recents": "Open the recents switcher",
	"open-explorer": "Toggle the explorer drawer"
};
const shortcutsList = document.getElementById("shortcuts-list");
const renderShortcutRow = (label, shortcut) => {
	const row = document.createElement("div");
	row.className = "shortcut-row";
	const name = document.createElement("span");
	name.textContent = label;
	const key = document.createElement("kbd");
	if (shortcut) {
		key.textContent = shortcut;
	} else {
		key.textContent = "Not set";
		key.className = "unset";
	}
	row.appendChild(name);
	row.appendChild(key);
	shortcutsList.appendChild(row);
};
if (typeof chrome !== "undefined" && chrome.commands && chrome.commands.getAll) {
	chrome.commands.getAll().then((commands) => {
		Object.keys(COMMAND_LABELS).forEach((name) => {
			const command = commands.find((c) => c.name === name);
			renderShortcutRow(COMMAND_LABELS[name], command && command.shortcut);
		});
	});
} else {
	Object.keys(COMMAND_LABELS).forEach((name) => renderShortcutRow(COMMAND_LABELS[name], null));
}
document.getElementById("edit-shortcuts").addEventListener("click", () => {
	if (typeof chrome !== "undefined" && chrome.tabs) {
		chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
	}
});
