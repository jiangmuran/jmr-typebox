const n=`/* TypeBox: original Google Fonts @import (Inter 700; Literata 400 + 400 italic)
   replaced with locally-vendored @font-face below (no CDN, no remote URLs).
   The font-dir placeholder below is rewritten to the bundled fonts/ URL
   at load time by src/themes/registry.js. */
@font-face {
  font-family: 'Literata';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(__FONT__/literata-400.woff2) format('woff2');
}
@font-face {
  font-family: 'Literata';
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url(__FONT__/literata-400-italic.woff2) format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(__FONT__/inter-400.woff2) format('woff2');
}

:root {
    --bg-color: #F0EDE6;                /* main editor background */
    --text-color: #333333;              /* body text color */
    --side-bar-bg-color: #F0EDE6;       /* sidebar background */
    --active-file-bg-color: rgba(115,147,179,0.1);  /* selected file highlight */
    --active-file-text-color: inherit;               /* selected file text color */
    --item-hover-bg-color: rgba(115,147,179,0.08);  /* sidebar item hover background */
}

/* ------------------------------
   Base styles
------------------------------- */
html, body {
    font-family: "Literata", serif;
    font-size: 18px;
    font-weight: 400;
    line-height: 1.65;
    margin: 0;
    padding: 0;
    background-color: #F0EDE6;
    color: #333333;
}

a {
    color: #333333;
    text-decoration: none;
    background-image: linear-gradient(rgba(115,147,179,0.25), rgba(115,147,179,0.25));
    background-repeat: no-repeat;
    background-size: 100% 0.35em;
    background-position: 0 88%;
    transition: background-size 0.2s ease-in-out;
}
a:hover {
    background-size: 100% 0.5em;
}

/* ------------------------------
   Writing column
------------------------------- */
#write {
    max-width: 40em;
    margin-left: auto;
    margin-right: auto;
    padding-left: 1em;
    padding-right: 1em;
}

/* ------------------------------
   Headings
------------------------------- */
h1 {
    font-family: "Inter", sans-serif;
    font-weight: 700;
    font-size: 2.5em;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    border-bottom: 3px solid #000000;
    padding-bottom: 0.3em;
}

h2 {
    font-family: "Inter", sans-serif;
    font-weight: 700;
    font-size: 2em;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
}

h3 {
    font-family: "Inter", sans-serif;
    font-weight: 700;
    font-size: 1.75em;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
}

h4 {
    font-family: "Inter", sans-serif;
    font-weight: 700;
    font-size: 1.5em;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
}

h5 {
    font-family: "Inter", sans-serif;
    font-weight: 700;
    font-size: 1.25em;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
}

h6 {
    font-family: "Inter", sans-serif;
    font-weight: 700;
    font-size: 1em;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
}

/* ------------------------------
   Code / Inline code
------------------------------- */
code, pre {
    font-family: Menlo, monospace;
    background-color: rgba(0,0,0,0.05);
    padding: 0.15em 0.3em;
    border-radius: 3px;
}

/* ------------------------------
   Blockquotes
------------------------------- */
blockquote {
    font-style: italic;
    background-color: rgba(115,147,179,0.08);
    padding: 0.5em 1em;
    margin-left: 1em;
    border-left: 3px solid #7393B3;
}

/* ------------------------------
   Horizontal rules
------------------------------- */
hr {
    border: none;
    border-top: 1px solid rgba(0,0,0,0.2);
    margin: 2em 0;
}

/* ------------------------------
   Lists
------------------------------- */
ul, ol {
    margin-left: 2em;
}

/* ------------------------------
   Tables
------------------------------- */
table {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
}

th {
    background-color: rgba(0,0,0,0.05);
    font-weight: bold;
    padding: 0.5em;
}

td {
    border-bottom: 1px solid rgba(0,0,0,0.1);
    padding: 0.5em;
}

tr:nth-child(even) {
    background-color: rgba(0,0,0,0.02);
}

/* ------------------------------
   Sidebar
------------------------------- */
#sidebar {
    background-color: #F0EDE6; /* match main background */
    color: #333333;            /* match body text */
    font-family: "Literata", serif;
}

#sidebar a {
    color: #7393B3;            /* links same as link highlights */
    text-decoration: none;
    font-family: "Literata", serif;
}

#sidebar ul li {
    padding: 0.25em 0.5em;
}`;export{n as default};
