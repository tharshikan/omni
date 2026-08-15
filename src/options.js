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
