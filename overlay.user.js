// ==UserScript==
// @name NSPX Overlay
// @version 2.2.1
// @description A set of tools for Blurple Canvas' website, including a live overlay.
// @icon https://renobei.github.io/prayge.png
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_deleteValue
// @grant GM_listValues
// @grant GM_xmlhttpRequest
// @connect self
// @connect media.discordapp.net
// @connect raw.githubusercontent.com
// @connect localhost
// @connect *
// @author renobel
// @include *://canvas.projectblurple.com/*
// @run-at document-idle
// @run-in normal-tabs
// @tag games
// @tag canvas
// @noframes
// @updateURL https://renobei.github.io/overlay.js
// @downloadURL https://renobei.github.io/overlay.user.js
// @supportURL
// ==/UserScript==
// this is taken from volcanofr, i edited it to fit our needs
// Greatly inspired by #FrenchCanvas (Zallom's work)
// https://discord.gg/fr - https://github.com/zallom

"use strict";

const DATA_DOMAIN = "https://renobei.github.io";
const API_DOMAIN = "https://canvas.projectblurple.com/api/v1";

/**
 * @typedef {{
 * 	id: number;
 * 	code: string;
 * 	name: string;
 * 	rgba: [number, number, number, ...number];
 * 	global: boolean;
 * 	invite: string | null;
 * 	guildName: string | null;
 * 	guildId: string | null;
 * }} PaletteColor
 */
/** @type {PaletteColor[] | null} */
let dataPalette = null;
/**
 * @type {{
 * 	id: number;
 * 	name: string;
 * 	width: number;
 * 	height: number;
 * 	startCoordinates: [number, number];
 * 	isLocked: boolean;
 * 	eventId: number | null;
 * 	webPlacingEnabled: boolean;
 * 	allColorsGlobal: boolean;
 * } | null}
 */
let dataCanvas = null;

/** @type {ImageData | null} */
let overlayCanvas = null;

/** @type {{ element: Element, type: string, listener: function }[]} */
const eventListeners = [];
/** @type {MutationObserver[]} */
const observers = [];
const STORAGE_PREFIX = "nspx-overlay";
const originalSend = XMLHttpRequest.prototype.send;
let overlayWatcherStarted = false;
/**
 * @param {Document | Blob | ArrayBuffer | TypedArray | DataView | FormData | URLSearchParams | string | null} [body]
 * @returns {void}
 */
XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener("readystatechange", async () => {
        if (this.readyState !== 4) return;

        if (this.status === 200 && (
            this.responseURL.startsWith(`${API_DOMAIN}/canvas/current/info`) ||
            this.responseURL.startsWith(`${API_DOMAIN}/canvas/${dataCanvas?.id || "2026"}/info`)
        )) {
            try {
                dataCanvas = JSON.parse(this.response);
                await makeSetups();
                console.debug("[Hub Watcher]", "Canvas data loaded:", dataCanvas);
            } catch (error) {
                console.error("[Hub Watcher]", "Error parsing canvas data:", error);
            }
        }

        if (this.status === 200 && (
            this.responseURL.startsWith(`${API_DOMAIN}/palette/current`) ||
            this.responseURL.startsWith(`${API_DOMAIN}/palette/${dataCanvas?.eventId || "2026"}`)
        )) {
            try {
                dataPalette = JSON.parse(this.response);
                console.debug("[Hub Watcher]", "Palette data loaded:", dataPalette);
            } catch (error) {
                console.error("[Hub Watcher]", "Error parsing palette data:", error);
            }
        }
    });

    originalSend.call(this, body);
}

function setupCoordinates() {
    let lastCoordinates = { x: 0, y: 0 };

    const observer = new MutationObserver(() => {
        if (!getCoordinatesEnabled()) return;

        const coordinates = getCoordinatesXY();

        if (coordinates === null || (
            coordinates.x === lastCoordinates.x &&
            coordinates.y === lastCoordinates.y
        )) return;

        lastCoordinates = coordinates;

        updateCoordinatesSelector(coordinates.x, coordinates.y);
    });

    observer.observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-selected"],
    });

    observers.push(observer);

    console.debug("[Hub Watcher]", "Coordinates selector setup complete.");
}

/**
 * @private
 * @returns {{ x: number, y: number } | null}
 */
function getCoordinatesXY() {
    let div = null;

    for (const element of document.querySelectorAll("div")) {
        const codes = element.querySelectorAll("code");

        if (
            codes.length >= 2 &&
            codes[0].textContent?.includes("x:") &&
            codes[1].textContent?.includes("y:")
        ) div = element;
    }

    if (div === null) {
        // console.debug("[Hub Watcher]", "Coordinates container not found.");
        return null;
    }

    const x = parseInt(div.querySelector("code:nth-child(1)")?.textContent?.replace("x:", "").trim() || "1") - 1;
    const y = parseInt(div.querySelector("code:nth-child(2)")?.textContent?.replace("y:", "").trim() || "1") - 1;

    return { x, y };
}

/**
 * @private
 * @returns {boolean | null}
 */
function getCoordinatesEnabled() {
    let div = null;

    for (const element of document.querySelectorAll("button[role=\"tab\"]")) {
        if (element.textContent?.trim() === "Place") div = element;
    }

    if (div === null) {
        console.warn("[Hub Watcher]", "Coordinates menu button not found.");
        return null;
    }

    return div.getAttribute("aria-selected") === "true";
}

/**
 * @private
 * @param {number} x
 * @param {number} y
 */
function updateCoordinatesSelector(x, y) {
    const color = getOverlayPixelColor(x, y);

    if (color === null) return;

    try {
        for (const button of document.querySelectorAll("button[role=\"option\"]")) {
            const swatch = getComputedStyle(button).getPropertyValue("--swatch-color")?.trim();

            if (!swatch) continue;

            // rgb(r,g,b) - rgba(r,g,b,a) - rgb(r g b / a)
            const match = swatch.match(/rgba?\((?:\s*(\d+)\s*),?(?:\s*(\d+)\s*),?(?:\s*(\d+)\s*)(?:(?:,?\s*([0-1](?:\.\d+)?))|(?:\/\s*([0-1](?:\.\d+)?)))?\)/);

            if (!match) continue;

            const r = parseInt(match[1]);
            const g = parseInt(match[2]);
            const b = parseInt(match[3]);
            const a = match[4] !== undefined
            ? Math.round(parseFloat(match[4]) * 255)
            : match[5] !== undefined
            ? Math.round(parseFloat(match[5]) * 255)
            : 255;

            if (
                r == color.rgba[0] &&
                g == color.rgba[1] &&
                b == color.rgba[2] &&
                a == (color.rgba[3] || 255)
            ) {
                button.click();
                console.debug("[Hub Watcher]", `Selected color at (${x},${y}):`, color);
                return;
            }
        }

        console.warn("[Hub Watcher]", `No matching color button found for color at (${x},${y}):`, color);
    } catch (error) {
        console.error("[Hub Watcher]", `Error selecting overlay color at (${x},${y}):`, error);
    }
}

/**
 * @public
 * @param {string} [url]
 * @param {number} [opacity]
 * @returns {HTMLImageElement | null}
 */
async function setupOverlay(url, opacity) {
    /** @type {HTMLDivElement | null} */
    const canvasWrapper = document.querySelector("div#canvas-pan-and-zoom");

    if (canvasWrapper === null) {
        console.warn("[Hub Watcher]", "Canvas wrapper not found.");
        return null;
    }

    /** @type {HTMLImageElement | null} */
    const canvasImg = document.querySelector("img[alt=\"Active Blurple Canvas\"]");

    if (canvasImg === null) {
        console.warn("[Hub Watcher]", "Canvas image not found.");
        return null;
    }

    /** @type {HTMLImageElement | null} */
    let overlay = document.getElementById("bhw-overlay");
    if (overlay !== null && overlay.tagName !== "IMG") {
        console.warn("[Hub Watcher]", "Element with id 'bhw-overlay' already exists but is not an img. Recreating it.");
        overlay.remove();
        overlay = null;
    }

    if (url === undefined) url = GM_getValue("${STORAGE_PREFIX}", `${DATA_DOMAIN}/template.png`);
    if (opacity === undefined) opacity = GM_getValue("bhw-overlay-opacity", 0.5);
    opacity = Math.min(1, Math.max(0, opacity));

    if (overlay === null) {
        const blobUrl = await getBlobFromURL(`${url}?t=${Math.ceil(Date.now() / 1000)}`);

        if (blobUrl === null) {
            console.warn("[Hub Watcher]", "Failed to define overlay image.");
            return null;
        }

        overlay = document.createElement("img");
        overlay.id = "bhw-overlay";
        overlay.crossOrigin = "anonymous";
        overlay.src = blobUrl;
        overlay.style.cssText = `
        position: absolute;
        transform: ${canvasImg.style.transform || "none"};
        top: 0;
        left: 0;
        width: ${canvasImg.style.width || "900px"};
        height: ${canvasImg.style.height || "900px"};
        max-width: unset;
        max-height: unset;
        image-rendering: pixelated;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-user-drag: none;
        opacity: ${opacity.toFixed(2)};
        `;

        canvasWrapper.appendChild(overlay);

        await setupOverlayCanvas(overlay);
    } else {
        if (!overlay.src.startsWith(url)) {
            const blobUrl = await getBlobFromURL(`${url}?t=${Math.ceil(Date.now() / 1000)}`);

            if (blobUrl === null) {
                console.warn("[Hub Watcher]", "Failed to update overlay image.");
                return null;
            }

            overlay.src = blobUrl;

            await setupOverlayCanvas(overlay);
        }

        if (overlay.style.opacity !== opacity.toFixed(2)) overlay.style.opacity = opacity.toFixed(2);
    }

    GM_setValue("${STORAGE_PREFIX}", url);
    GM_setValue("bhw-overlay-opacity", opacity);

    return overlay;
}
function watchOverlay() {
    if (overlayWatcherStarted) return;
    overlayWatcherStarted = true;

    const observer = new MutationObserver(() => {
        const canvasImg = document.querySelector("#canvas-image-wrapper > img");
        const overlay = document.getElementById("bhw-overlay");

        if (canvasImg && !overlay) {
            console.warn("[Hub Watcher]", "Overlay disappeared; restoring.");
            setupOverlay();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}
/**
 * @private
 * @param {string} url
 * @returns {Promise<string | null>}
 */
async function getBlobFromURL(url) {
    console.warn("[Hub Watcher]", "Downloading following URL:", url);

    const response = await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            url,
            method: "GET",
            responseType: "blob",
            onload: resolve,
            onerror: reject,
            ontimeout: reject,
        });
    }).catch((error) => {
        console.error("[Hub Watcher]", `Error fetching ${url}:`, error);
    });

    if (!response) return null;

    if (response.status < 200 || response.status >= 300) {
        console.error("[Hub Watcher]", `Failed to fetch ${url}:`, response);
        return null;
    }

    return URL.createObjectURL(response.response);
}

/**
 * @private
 * @param {HTMLImageElement} overlay
 * @return {Promise<void>}
 */
async function setupOverlayCanvas(overlay) {
    console.debug("[Hub Watcher]", "Caching overlay image...");
    if (overlay.complete !== true) await new Promise((resolve, reject) => {
        const timeout = setTimeout(reject, 5_000);

        overlay.onload = () => {
            clearTimeout(timeout);
            resolve();
        };

        overlay.onerror = (error) => {
            clearTimeout(timeout);
            console.error("[Hub Watcher]", "Error loading overlay image:", error);
            reject();
        };
    });

    const canvas = document.createElement("canvas");
    canvas.width = overlay.naturalWidth;
    canvas.height = overlay.naturalHeight;

    const ctx = canvas.getContext("2d");

    if (ctx === null) {
        console.error("[Hub Watcher]", "Could not get canvas context.");
        return;
    }

    ctx.drawImage(overlay, 0, 0);

    overlayCanvas = ctx.getImageData(0, 0, canvas.width, canvas.height);
    console.debug("[Hub Watcher]", "Overlay image cached.", overlayCanvas);
}

/**
 * @public
 * @param {number} x 0-based
 * @param {number} y 0-based
 * @returns {PaletteColor | null}
 */
function getOverlayPixelColor(x, y) {
    let stop = false;
    if (overlayCanvas === null) {
        console.warn("[Hub Watcher]", "Overlay canvas not set up yet.");
        stop = true;
    }

    if (dataPalette === null) {
        console.warn("[Hub Watcher]", "Palette data not loaded yet.");
        stop = true;
    }

    if (dataCanvas === null) {
        console.warn("[Hub Watcher]", "Canvas data not loaded yet.");
        stop = true;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        console.warn("[Hub Watcher]", "Invalid pixel coordinates:", { x, y });
        stop = true;
    }

    if (x < 0 || y < 0 || overlayCanvas && (x >= overlayCanvas.width || y >= overlayCanvas.height)) {
        console.warn("[Hub Watcher]", "Overlay pixel coordinates out of bounds:", { x, y });
        stop = true;
    }

    if (stop) return null;

    const index = (y * overlayCanvas.width + x) * 4;
    const [r, g, b, a] = overlayCanvas.data.slice(index, index + 4);

    let color = null;
    if (a === 255) {
        color = dataPalette.find(color =>
        color.rgba[0] === r &&
        color.rgba[1] === g &&
        color.rgba[2] === b &&
        (color.rgba[3] || 255) === a
        ) || null;
    } else if (a > 0) color = dataPalette.find(color => color.code === "blank") || null;

    return color;
}

/**
 * @public
 * @return {void}
 */
async function updateOverlay() {
    const overlay = await setupOverlay();

    if (overlay === null) {
        console.warn("[Hub Watcher]", "Overlay image not found, cannot update.");
        return;
    }

    overlay.src = `${overlay.src.split("?")[0]}?t=${Math.ceil(Date.now() / 1000)}`;
}

/**
 * @public
 * @returns {Promise<HTMLDivElement>}
 */
async function setupPanel() {
    if (document.readyState === "loading") await new Promise((resolve) => {
        const listener = () => {
            resolve();
            document.removeEventListener("DOMContentLoaded", listener);
        };

        eventListeners.push({ element: document, type: "DOMContentLoaded", listener });
        document.addEventListener("DOMContentLoaded", resolve);
    });

    /** @type {HTMLDivElement | null} */
    let panel = document.getElementById("bhw-panel");

    if (panel !== null && panel.tagName !== "DIV") {
        console.warn("[Hub Watcher]", "Element with id 'bhw-panel' already exists but is not a div. Recreating it.");
        panel.remove();
        panel = null;
    }

    if (panel === null) {
        panel = document.createElement("div");
        panel.id = "bhw-panel";
        panel.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        margin: 15px;
        background-color: var(--discord-legacy-not-quite-black);
        border: var(--card-border);
        color: white;
        padding: 10px;
        border-radius: 5px;
        display: flex;
        flex-direction: column;
        gap: 5px;
        user-select: none;
        -webkit-user-select: none;
        z-index: 255;
        `;

        makeDraggable(panel);

        document.body.appendChild(panel);
    }

    setupPanelUrl(panel);
    setupPanelOpacity(panel);
    setupPanelButton(panel);

    return panel;
}

/**
 * @public
 * @param {HTMLElement} element
 * @return {void}
 */
function makeDraggable(element) {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;
    let defaultCursor = "";

    const moveBar = document.createElement("div");
    moveBar.style.cssText = `
    height: 10px;
    background-image: radial-gradient(circle at center, white 67%, transparent 33%);
    background-size: 2px 2px;
    background-position: 0 0;
    background-repeat: repeat;
    opacity: 0.75;
    cursor: move;
    margin-bottom: 5px;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    `;

    element.prepend(moveBar);

    /**
     * @param {PointerEvent} event
     * @returns {void}
     */
    function startDragging(event) {
        isDragging = true;

        offsetX = event.clientX - element.getBoundingClientRect().left;
        offsetY = event.clientY - element.getBoundingClientRect().top;

        defaultCursor = element.style.cursor;
        element.style.cursor = "move";

        event.preventDefault();
    }

    /**
     * @param {PointerEvent} event
     * @return {void}
     */
    function drag(event) {
        if (!isDragging) return;

        element.style.left = `${Math.max(0, Math.min(
            event.clientX - offsetX,
            window.innerWidth - getSize(element).width
        ))}px`;

        element.style.top = `${Math.max(0, Math.min(
            event.clientY - offsetY,
            window.innerHeight - getSize(element).height
        ))}px`;
    }

    /**
     * @param {PointerEvent} event
     * @return {void}
     */
    function stopDragging(event) {
        isDragging = false;
        element.style.cursor = defaultCursor;
    }

    function resize() {
        element.style.left = `${Math.max(0, Math.min(
            parseFloat(element.style.left) || 0,
                                                     window.innerWidth - getSize(element).width
        ))}px`;

        element.style.top = `${Math.max(0, Math.min(
            parseFloat(element.style.top) || 0,
                                                    window.innerHeight - getSize(element).height
        ))}px`;
    }

    eventListeners.push({ element: moveBar, type: "pointerdown", listener: startDragging });
    moveBar.addEventListener("pointerdown", startDragging);
    eventListeners.push({ element: window, type: "pointermove", listener: drag });
    window.addEventListener("pointermove", drag);
    eventListeners.push({ element: window, type: "pointerup", listener: stopDragging });
    window.addEventListener("pointerup", stopDragging);
    eventListeners.push({ element: window, type: "pointercancel", listener: stopDragging });
    window.addEventListener("pointercancel", stopDragging);
    eventListeners.push({ element: window, type: "resize", listener: resize });
    window.addEventListener("resize", resize);
}

/**
 * @param {HTMLElement} element
 * @returns {{width: number, height: number}}
 */
function getSize(element) {
    const rect = element.getBoundingClientRect();

    return {
        width: rect.width
        + parseFloat(getComputedStyle(element).marginLeft)
        + parseFloat(getComputedStyle(element).marginRight),
        height: rect.height
        + parseFloat(getComputedStyle(element).marginTop)
        + parseFloat(getComputedStyle(element).marginBottom)
    }
}

/**
 * @private
 * @param {HTMLDivElement} children
 * @returns {[HTMLLabelElement, HTMLSelectElement]}
 */
function setupPanelUrl(children) {
    /** @type {HTMLLabelElement | null} */
    let panelUrlLabel = document.getElementById("bhw-panel--url-label");

    if (panelUrlLabel !== null && (panelUrlLabel.tagName !== "LABEL" || !children.contains(panelUrlLabel))) {
        console.warn("[Hub Watcher]", "Element with id 'bhw-panel--url-label' already exists but is not a label or is not a child of the panel. Recreating it.");
        panelUrlLabel.remove();
        panelUrlLabel = null;
    }

    if (panelUrlLabel === null) {
        panelUrlLabel = document.createElement("label");
        panelUrlLabel.id = "bhw-panel--url-label";
        panelUrlLabel.textContent = "Overlay:";
        panelUrlLabel.htmlFor = "bhw-panel--url";
        children.appendChild(panelUrlLabel);
    }

    const url = GM_getValue("${STORAGE_PREFIX}", `${DATA_DOMAIN}/template.png`);

    /** @type {HTMLSelectElement | null} */
    let panelUrl = document.getElementById("bhw-panel--url");

    if (panelUrl !== null && (panelUrl.tagName !== "SELECT" || !children.contains(panelUrl))) {
        console.warn("[Hub Watcher]", "Element with id 'bhw-panel--url' already exists but is not a select or is not a child of the panel. Recreating it.");
        panelUrl.remove();
        panelUrl = null;
    }

    if (panelUrl === null) {
        panelUrl = document.createElement("select");
        panelUrl.id = "bhw-panel--url";
        panelUrl.placeholder = "Overlay URL";
        panelUrl.style.cssText = `
        width: 100%;
        padding: 5px;
        `;

        panelUrl.options.add(new Option("NSPX", `${DATA_DOMAIN}/template.png`));
        panelUrl.options.add(new Option("Bozo Painters", `${DATA_DOMAIN}/bozo.png`));
        panelUrl.options.add(new Option("Custom", "custom", true, true));

        for (let i = 0; i < panelUrl.options.length; i += 1) if (url.endsWith(panelUrl.options[i].value.replace(DATA_DOMAIN, ""))) panelUrl.selectedIndex = i;

        if (panelUrl.selectedIndex !== panelUrl.options.length - 1) {
            panelUrl.options[panelUrl.options.length - 1].setAttribute("disabled", "");
        }

        panelUrl.onchange = /** @param {Event} event */ (event) => {
            /** @type {HTMLSelectElement | null} */
            const target = event.target;

            if (target === null || target.tagName !== "SELECT") {
                console.warn("[Hub Watcher]", "Unexpected event target for panelUrl onchange:", event.target);
                return;
            }

            if (
                !target.options[target.options.length - 1].hasAttribute("disabled") &&
                target.selectedIndex !== target.options.length - 1
            ) target.options[target.options.length - 1].setAttribute("disabled", "");

            setupOverlay(target.value);
        };

        children.appendChild(panelUrl);
    }

    return [panelUrlLabel, panelUrl];
}

/**
 * @private
 * @param {HTMLDivElement} children
 * @returns {[HTMLLabelElement, HTMLInputElement]}
 */
function setupPanelOpacity(children) {
    /** @type {HTMLLabelElement | null} */
    let panelOpacityLabel = document.getElementById("bhw-panel--opacity-label");

    if (panelOpacityLabel !== null && (panelOpacityLabel.tagName !== "LABEL" || !children.contains(panelOpacityLabel))) {
        console.warn("[Hub Watcher]", "Element with id 'bhw-panel--opacity-label' already exists but is not a label or is not a child of the panel. Recreating it.");
        panelOpacityLabel.remove();
        panelOpacityLabel = null;
    }

    if (panelOpacityLabel === null) {
        panelOpacityLabel = document.createElement("label");
        panelOpacityLabel.id = "bhw-panel--opacity-label";
        panelOpacityLabel.textContent = "Overlay Opacity:";
        panelOpacityLabel.htmlFor = "bhw-panel--opacity";
        children.appendChild(panelOpacityLabel);
    }

    const opacity = Math.min(1, Math.max(0, GM_getValue("bhw-overlay-opacity", 0.5)));

    /** @type {HTMLInputElement | null} */
    let panelOpacity = document.getElementById("bhw-panel--opacity");

    if (panelOpacity !== null && (panelOpacity.tagName !== "INPUT" || !children.contains(panelOpacity))) {
        console.warn("[Hub Watcher]", "Element with id 'bhw-panel--opacity' already exists but is not an input or is not a child of the panel. Recreating it.");
        panelOpacity.remove();
        panelOpacity = null;
    }

    if (panelOpacity === null) {
        panelOpacity = document.createElement("input");
        panelOpacity.id = "bhw-panel--opacity";
        panelOpacity.type = "range";
        panelOpacity.min = "0";
        panelOpacity.max = "1";
        panelOpacity.step = "0.01";
        panelOpacity.placeholder = "Overlay Opacity (0-1)";
        panelOpacity.value = opacity.toFixed(2);
        panelOpacity.style.cssText = `
        width: 100%;
        padding: 5px;
        `;

        panelOpacity.onchange = /** @param {Event} event */ (event) =>
        setupOverlay(undefined, parseFloat(/** @type {HTMLInputElement} */ (event.target).value.trim()));

        children.appendChild(panelOpacity);
    }

    if (panelOpacity.value !== opacity.toFixed(2)) panelOpacity.value = opacity.toFixed(2);

    return [panelOpacityLabel, panelOpacity];
}

/**
 * @private
 * @param {HTMLDivElement} children
 * @returns {HTMLDivElement}
 */
function setupPanelButton(children) {
    /** @type {HTMLDivElement | null} */
    let panelButton = document.getElementById("bhw-panel--button");

    if (panelButton !== null && (panelButton.tagName !== "DIV" || !children.contains(panelButton))) {
        console.warn("[Hub Watcher]", "Element with id 'bhw-panel--button' already exists but is not a div or is not a child of the panel. Recreating it.");
        panelButton.remove();
        panelButton = null;
    }

    if (panelButton === null) {
        panelButton = document.createElement("div");
        panelButton.id = "bhw-panel--button";
        panelButton.style.cssText = `
        display: flex;
        flex-direction: row;
        gap: 5px;
        `;
        children.appendChild(panelButton);
    }

    setupPanelButtonReset(panelButton);
    setupPanelButtonUpdate(panelButton);

    return panelButton;
}

/**
 * @private
 * @param {HTMLDivElement} children
 * @returns {HTMLButtonElement}
 */
function setupPanelButtonReset(children) {
    /** @type {HTMLButtonElement | null} */
    let panelButtonReset = document.getElementById("bhw-panel--button--reset");

    if (panelButtonReset !== null && (panelButtonReset.tagName !== "BUTTON" || !children.contains(panelButtonReset))) {
        console.warn("[Hub Watcher]", "Element with id 'bhw-panel--button--reset' already exists but is not a button or is not a child of the panel. Recreating it.");
        panelButtonReset.remove();
        panelButtonReset = null;
    }

    if (panelButtonReset === null) {
        panelButtonReset = document.createElement("button");
        panelButtonReset.id = "bhw-panel--button--reset";
        panelButtonReset.textContent = "Reset";
        panelButtonReset.style.cssText = `
        padding: 5px;
        min-width: 5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        `;

        panelButtonReset.onclick = async () => {
            for (const key of GM_listValues()) if (key.startsWith("bhw-")) GM_deleteValue(key);

            await clearSetups();
            await makeSetups();
        }

        children.appendChild(panelButtonReset);
    }

    return panelButtonReset;
}

/**
 * @private
 * @param {HTMLDivElement} children
 * @returns {HTMLButtonElement}
 */
function setupPanelButtonUpdate(children) {
    /** @type {HTMLButtonElement | null} */
    let panelButtonUpdate = document.getElementById("bhw-panel--button--update");

    if (panelButtonUpdate !== null && (panelButtonUpdate.tagName !== "BUTTON" || !children.contains(panelButtonUpdate))) {
        console.warn("[Hub Watcher]", "Element with id 'bhw-panel--button--update' already exists but is not a button or is not a child of the panel. Recreating it.");
        panelButtonUpdate.remove();
        panelButtonUpdate = null;
    }

    if (panelButtonUpdate === null) {
        panelButtonUpdate = document.createElement("button");
        panelButtonUpdate.id = "bhw-panel--button--update";
        panelButtonUpdate.textContent = "Update Overlay";
        panelButtonUpdate.style.cssText = `
        padding: 5px;
        min-width: 5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        `;

        panelButtonUpdate.onclick = () => updateOverlay();

        children.appendChild(panelButtonUpdate);
    }

    return panelButtonUpdate;
}

/**
 * @public
 * @returns {Promise<void>}
 */
async function makeSetups() {
    console.debug("[Hub Watcher]", "Setting up...");

    const listener = async () => {
        await clearSetups();
        await makeSetups();
        watchOverlay();
    };
    if (navigation) {
        eventListeners.push({ element: navigation, type: "navigate", listener });
        navigation.addEventListener("navigate", listener);
    }

    if (document.getElementById("canvas-wrapper") === null)
        return;

    setupOverlay();
    await setupPanel();
    setupCoordinates();

    setTimeout(async () => {
        if (dataCanvas === null) {
            dataCanvas = await fetch(`${API_DOMAIN}/canvas/current/info`)
            .then(res => res.json())
            .catch(error => console.error("[Hub Watcher]", "Error fetching canvas data:", error) && null);
        }
        if (dataPalette === null) {
            dataPalette = await fetch(`${API_DOMAIN}/palette/current`)
            .then(res => res.json())
            .catch(error => console.error("[Hub Watcher]", "Error fetching palette data:", error) && null);
        }
    }, 500);

    console.debug("[Hub Watcher]", "Setup complete.");
}

async function clearSetups() {
    console.debug("[Hub Watcher]", "Clearing setups...");

    for (const { element, type, listener } of eventListeners) {
        element.removeEventListener(type, listener);
    }
    eventListeners.length = 0;

    for (const observer of observers) {
        observer.disconnect();
    }
    observers.length = 0;

    const panel = document.getElementById("bhw-panel");
    if (panel !== null) panel.remove();

    const overlay = document.getElementById("bhw-overlay");
    if (overlay !== null) overlay.remove();

    overlayCanvas = null;
    dataCanvas = null;
    dataPalette = null;

    console.debug("[Hub Watcher]", "Setups cleared.");
}

const searchParams = new URLSearchParams(window.location.search);

if (searchParams.get("overlay-url") !== null) {
    /** @type {URL | undefined} */
    let url = undefined;
    try {
        url = new URL(searchParams.get("overlay-url")?.trim() || "");
    } catch {}

    if (url === undefined) {
        console.warn("[Hub Watcher]", "Overlay URL is not a valid URL:", searchParams.get("overlay-url")?.trim());
        return;
    }

    if (url.protocol !== "https:" && url.protocol !== "data:" && url.protocol !== "blob:") {
        console.warn("[Hub Watcher]", "Overlay URL has unsupported protocol (only https, data, and blob are supported):", url);
        return;
    }

    if ([".png", ".jpg", ".jpeg", ".webp"].every(extension => !url.pathname.endsWith(extension))) {
        console.warn("[Hub Watcher]", "Overlay URL does not seem to point to an image (should end with .png, .jpg, .jpeg or .webp):", url);
        return;
    }

    GM_setValue("${STORAGE_PREFIX}", url.href);
}

if (searchParams.get("overlay-opacity") !== null) {
    let opacity = parseFloat(searchParams.get("overlay-opacity")?.trim() || NaN);

    if (!Number.isFinite(opacity)) {
        console.warn("[Hub Watcher]", "Overlay opacity is not a valid number:", searchParams.get("overlay-opacity")?.trim());
        return;
    }

    if (opacity > 1 && opacity <= 100) opacity /= 100;
    else if (opacity < 0 || opacity > 1) {
        console.warn("[Hub Watcher]", "Overlay opacity is out of bounds (should be between 0 and 1):", opacity);
        return;
    }

    GM_setValue("bhw-overlay-opacity", Math.min(1, Math.max(0, opacity)));
}
