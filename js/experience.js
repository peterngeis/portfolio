/*
 * experience.js
 * The experience timeline: the big year rolls like an odometer and the progress rail fills
 * as each timeline entry passes the middle of the screen.
 */
(function (Site) {
  "use strict";

  const PHONE_MAXIMUM_WIDTH = 760;   // matches the phone breakpoint in css/responsive.css
  const MAXIMUM_YEAR_FONT_SIZE = 200;

  const timelineEntries = Array.from(document.querySelectorAll(".timeline-entry"));
  const digitReels = Array.from(document.querySelectorAll(".reel"));
  const railSteps = Array.from(document.querySelectorAll(".rail li"));
  const dialTitle = document.getElementById("dial-title");
  const odometer = document.querySelector(".odometer");
  const dial = document.querySelector(".dial");

  /* ---------- The year, rolling like an odometer ---------- */

  // Each digit of the year is a tall column that slides to the right digit. The column holds the digits 0 to 9
  // five times over, so it can keep sliding in either direction without running out. Lets the year count
  // the way a real odometer does.
  const DIGITS_PER_COPY = 10;
  const COPIES_PER_REEL = 5;
  const STRIP_LENGTH = DIGITS_PER_COPY * COPIES_PER_REEL;
  const HOME_COPY_START = 2 * DIGITS_PER_COPY;   // a reel rests in the middle copy, with room to roll either way

  // position = which spot in the column is showing, % 10 yields the digit on display.
  const reels = digitReels.map((element) => ({ element, position: HOME_COPY_START }));

  reels.forEach((reel) => {
    for (let spot = 0; spot < STRIP_LENGTH; spot++) {
      const digitElement = document.createElement("span");
      digitElement.textContent = String(spot % DIGITS_PER_COPY);
      reel.element.appendChild(digitElement);
    }
    setReelPosition(reel, HOME_COPY_START, false);
    // When a roll finishes, quietly move the reel back to the middle copy (same digit) so it never runs out of room.
    reel.element.addEventListener("transitionend", (event) => {
      if (event.propertyName === "transform") {
        returnReelToMiddle(reel);
      }
    });
  });

  function setReelPosition(reel, position, isAnimated) {
    reel.position = position;
    if (!isAnimated) {
      reel.element.style.transition = "none";
    }
    reel.element.style.transform = "translateY(-" + position + "em)";
    if (!isAnimated) {
      reel.element.getBoundingClientRect();  
      reel.element.style.transition = "";
    }
  }

  function returnReelToMiddle(reel) {
    const digit = ((reel.position % DIGITS_PER_COPY) + DIGITS_PER_COPY) % DIGITS_PER_COPY;
    if (reel.position !== HOME_COPY_START + digit) {
      setReelPosition(reel, HOME_COPY_START + digit, false);
    }
  }

  let shownYear = null;

  function showYear(year) {
    reels.forEach((reel, place) => {
      const unit = Math.pow(10, reels.length - 1 - place);   // 1000, 100, 10, 1 from left to right
      if (shownYear === null) {
        // The first time, roll up from 0 to the digit.
        setReelPosition(reel, HOME_COPY_START + (Math.floor(year / unit) % 10), true);
        return;
      }
      // How many notches this digit turns, based on timeline
      const notches = Math.floor(year / unit) - Math.floor(shownYear / unit);
      if (reel.position + notches < 0 || reel.position + notches >= STRIP_LENGTH) {
        returnReelToMiddle(reel);   // only happens if rolls pile up faster than they finish
      }
      setReelPosition(reel, reel.position + notches, true);
    });
    shownYear = year;
  }

  let currentEntryIndex = -1;

  function showEntry(entryIndex) {
    if (entryIndex === currentEntryIndex) {
      return;
    }
    currentEntryIndex = entryIndex;

    showYear(Number(timelineEntries[entryIndex].getAttribute("data-year")));   // from data-year on each .timeline-entry in index.html
    railSteps.forEach((step, stepIndex) => {
      step.classList.toggle("is-complete", stepIndex <= entryIndex);
    });
    timelineEntries.forEach((entry, index) => {
      entry.classList.toggle("is-current", index === entryIndex);
    });
    dialTitle.textContent = timelineEntries[entryIndex].querySelector("h3").textContent;
  }

  // The current entry is the last one whose top has passed the middle of the screen.
  function updateExperienceDial() {
    const middleOfScreen = Site.viewportHeight * 0.5;
    let currentIndex = 0;
    for (let index = 0; index < timelineEntries.length; index++) {
      if (timelineEntries[index].getBoundingClientRect().top < middleOfScreen) {
        currentIndex = index;
      }
    }
    showEntry(currentIndex);
  }

  // Sizes the big year to fit its column on desktop.
  function fitOdometer() {
    odometer.style.fontSize = "";
    if (Site.viewportWidth <= PHONE_MAXIMUM_WIDTH) {
      return;
    }
    odometer.style.fontSize = "100px";
    const widthAt100px = odometer.scrollWidth;
    const availableWidth = dial.clientWidth;
    odometer.style.fontSize = Math.min(MAXIMUM_YEAR_FONT_SIZE, 100 * availableWidth / widthAt100px * 0.97) + "px";
  }

  Site.onMeasure(fitOdometer);
  Site.onFrame(updateExperienceDial);
})(window.Site);
