# [Portfolio](https://www.petergeis.com)

A static site with HTML, CSS, JS, and an `images/` folder.

## How the project is organized

The page is a stack of sections. Each section has one stylesheet and, where it needs one, one script, and the files share the section's name.

| Page section | Stylesheet | Script |
| --- | --- | --- |
| (shared: colors, buttons, top bar) | `css/base.css` | |
| Landing: loader, name, radar pulses that reveal the build photo | `css/hero.css` | `js/hero.js` |
| Introduction | `css/statement.css` | `js/statement.js` |
| Scroll pauses (hold a frame still on screen) | `css/scroll-pause.css` | `js/scroll-pause.js` |
| Field photos (map tour, settles onto open photos) | `css/field-photos.css` | `js/field-photos.js` |
| On the clock / Off the clock panels (full screen) | `css/split.css` | |
| Experience timeline | `css/experience.css` | `js/experience.js` |
| Class demo (painter) | `css/class-demo.css` | `js/painter.js` |
| Senior design | `css/senior-design.css` | |
| Off the clock: My current build (zooming photo, part points) | `css/build-photo.css` | `js/build-photo.js` |
| More builds: tinker time line and its keyboard and band trays | `css/builds.css` | `js/tinker-trays.js` |
| More builds: ski winch card and the side pane | `css/builds.css` | `js/drawer.js` |
| Toolkit ticker | `css/toolkit.css` | `js/toolkit.js` |
| Credentials (certifications and hands-on qualifications) | `css/credentials.css` | |
| Contact and footer | `css/contact.css` | |
| Phone and tablet layouts, reduced motion | `css/responsive.css` (keep last) | |
| Top bar: current chapter, background on phones | | `js/nav.js` |
| Videos that play while on screen (drop test, keyboard) | | `js/video.js` |
| Shared helpers and the one animation loop | | `js/core.js` |

Other files:

```
index.html            all the page content, with a labeled comment above each section
images/               webp or mp4
favicon.svg           
favicon.ico           
apple-touch-icon.png  
robots.txt            avoiding scraping, google page rank. 
.gitattributes        keeps line endings consistent between Windows and the repository
```