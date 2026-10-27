/*
 * video.js
 * Plays muted, looping clips while they're on screen and pauses them
 * when they scroll away. Reduced motion and autoplay off keeps the play controls.
 */
(function (Site) {
  "use strict";

  const videos = Array.from(document.querySelectorAll("video[data-autoplay]"));
  if (!videos.length || !Site.motionEnabled || !("IntersectionObserver" in window)) {
    return;
  }

  const visibleVideos = new Set();

  function playIfAllowed(video) {
    if (Site.animationsPaused) {
      return;   // while animations are paused, clips wait
    }
    const playPromise = video.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(() => { video.setAttribute("controls", ""); });
    }
  }

  videos.forEach((video) => {
    video.muted = true;
    video.removeAttribute("controls");

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          visibleVideos.add(video);
          playIfAllowed(video);
        } else {
          visibleVideos.delete(video);
          video.pause();
        }
      });
    }, { threshold: 0.25 });
    observer.observe(video);
  });

  // Pausing stops every clip; resuming plays the ones on screen.
  Site.onPauseChange((isPaused) => {
    if (isPaused) {
      videos.forEach((video) => video.pause());
    } else {
      visibleVideos.forEach(playIfAllowed);
    }
  });
})(window.Site);
