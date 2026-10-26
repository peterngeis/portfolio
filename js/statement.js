/*
 * statement.js
 * The introduction: the large statement fills in word by word as you scroll, and the Sensō-ji photo
 * is sized so the statement, photo, and caption all fit on one screen together.
 */
(function (Site) {
  "use strict";
  const { clamp } = Site;

  /* ---------- Settings you can tweak ---------- */

  const STATEMENT = {
    dimOpacity: 0.16,    // opacity of words that haven't filled in yet
    startAt: 0.5,        // words start turning white when the statement's top reaches this fraction of the screen height
    finishAt: 0.12       // with no pause, every word is white by the time its top reaches this fraction;
  };

  const MINIMUM_PHOTO_HEIGHT = 220;     // smallest the photo may shrink to, in pixels tall
  const STACKED_MAXIMUM_WIDTH = 860;   // at or below this width the photo sits above the paragraphs (matches css/statement.css)

  const STATEMENT_PHOTO = {
    maxShare: 0.575,      // the photo's widest size, as a fraction of the width of the grid it sits in
    shrinkStep: 0.94,     // each time the photo block is too tall, it shrinks by this factor and is measured again
    maxAttempts: 24,      // safety limit for that loop
    bottomMargin: 24      // pixels of breathing room kept below the photo row
  };

  /* ---------- Word-by-word fill ---------- */

  const statementText = document.getElementById("statement-text");
  const wordElements = [];
  const wordOpacities = [];   // the last opacity written to each word, so unchanged words are skipped
  let statementTop = 0;

  // Split the statement into one span per word (only when motion is allowed).
  if (Site.motionEnabled) {
    const words = statementText.textContent.trim().split(/\s+/);
    statementText.textContent = "";
    words.forEach((word, index) => {
      const wordElement = document.createElement("span");
      wordElement.className = "statement-word";
      wordElement.textContent = word;
      statementText.appendChild(wordElement);
      if (index < words.length - 1) {
        statementText.appendChild(document.createTextNode(" "));
      }
      wordElements.push(wordElement);
      wordOpacities.push(-1);
    });
  }

  function measureStatement() {
    statementTop = Site.documentTop(statementText);
  }

  // 0 to 1: how much of the statement has filled in. It starts when the statement's top reaches startAt of the
  // screen, and finishes when the intro frame stops for its pause (or, with no pause, when the top reaches finishAt).
  function statementProgress() {
    const fillStart = statementTop - Site.viewportHeight * STATEMENT.startAt;
    const pause = Site.pauseFrames.intro;
    const fillEnd = pause && pause.active
      ? pause.pinStart
      : statementTop - Site.viewportHeight * STATEMENT.finishAt;
    return clamp((Site.scrollY - fillStart) / Math.max(1, fillEnd - fillStart), 0, 1);
  }

  function updateStatement() {
    const wordsFilled = statementProgress() * wordElements.length * 1.08;
    for (let index = 0; index < wordElements.length; index++) {
      const fillAmount = clamp(wordsFilled - index, 0, 1);
      const opacity = Math.round((STATEMENT.dimOpacity + (1 - STATEMENT.dimOpacity) * fillAmount) * 100) / 100;
      if (opacity !== wordOpacities[index]) {
        wordElements[index].style.opacity = opacity;
        wordOpacities[index] = opacity;
      }
    }
  }

  /* ---------- Photo sizing ---------- */

  // Sizes the Sensō-ji photo so the statement, the photo, and the paragraphs all fit on
  // one screen together. Side by side, the photo takes as much of the width as the height allows and the
  // paragraphs take the rest. Stacked (phones), only the photo and its caption share the room.
  function fitStatementPhoto() {
    const figure = document.querySelector(".statement-figure");
    if (!figure) {
      return;
    }
    const image = figure.querySelector("img");
    const caption = figure.querySelector("figcaption");
    const copy = document.querySelector(".statement-copy");
    const grid = figure.parentNode;

    const aspectRatio = parseFloat(image.getAttribute("width")) / parseFloat(image.getAttribute("height"));
    const minimumWidth = Math.ceil(MINIMUM_PHOTO_HEIGHT * aspectRatio);
    const navHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-height")) || 64;
    const gridGap = parseFloat(getComputedStyle(grid).marginTop) || 0;
    const roomForGrid = Site.viewportHeight - navHeight - statementText.offsetHeight - gridGap - STATEMENT_PHOTO.bottomMargin;

    grid.style.gridTemplateColumns = "";
    figure.style.width = "";

    if (Site.viewportWidth <= STACKED_MAXIMUM_WIDTH) {
      const columnWidth = figure.offsetWidth;
      // Two passes: narrowing the photo can wrap the caption onto a second line, which needs room too.
      for (let pass = 0; pass < 2; pass++) {
        const captionHeight = caption ? caption.offsetHeight + parseFloat(getComputedStyle(caption).marginTop) : 0;
        const photoWidth = Math.min(columnWidth, Math.max(MINIMUM_PHOTO_HEIGHT, roomForGrid - captionHeight) * aspectRatio);
        figure.style.width = Math.floor(photoWidth) + "px";
      }
      return;
    }

    // Side by side: start at the widest the photo may be, and shrink it until the taller of the photo block
    // and the paragraphs fits. A narrower photo also gives the paragraphs more width, so they get shorter too.
    let photoWidth = Math.floor(grid.clientWidth * STATEMENT_PHOTO.maxShare);
    for (let attempt = 0; attempt < STATEMENT_PHOTO.maxAttempts; attempt++) {
      grid.style.gridTemplateColumns = photoWidth + "px minmax(0, 1fr)";
      const rowHeight = Math.max(figure.offsetHeight, copy.offsetHeight);
      if (rowHeight <= roomForGrid || photoWidth <= minimumWidth) {
        break;
      }
      photoWidth = Math.max(minimumWidth, Math.floor(photoWidth * STATEMENT_PHOTO.shrinkStep));
    }
  }

  Site.onMeasure(fitStatementPhoto, 10);   // runs before the scroll pauses (js/scroll-pause.js), which depend on its result
  if (Site.motionEnabled) {
    Site.onMeasure(measureStatement);
    Site.onFrame(updateStatement);
  }
})(window.Site);
