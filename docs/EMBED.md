# Embedding VEYRA in a portfolio

Live URL: https://wf5psycho.github.io/veyra/

## Option 1: playable window (recommended)

```html
<section class="project">
  <h2>VEYRA, a 3D climbing game</h2>
  <p>A Cairn-inspired free-climbing survival game built with AI (Claude Code). Click inside to play.</p>
  <div style="position:relative;width:100%;aspect-ratio:16/9;max-height:80vh">
    <iframe src="https://wf5psycho.github.io/veyra/" title="VEYRA, a climbing game"
            style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:12px"
            allow="fullscreen" allowfullscreen loading="lazy"></iframe>
  </div>
  <p><a href="https://wf5psycho.github.io/veyra/" target="_blank" rel="noopener">Open full screen ↗</a>
     · <a href="https://github.com/WF5psycho/veyra" target="_blank" rel="noopener">Source code ↗</a></p>
</section>
```

## Option 2: preview image that links to the game (lighter page)

```html
<a href="https://wf5psycho.github.io/veyra/" target="_blank" rel="noopener">
  <img src="https://wf5psycho.github.io/veyra/screenshots/valley.png" alt="VEYRA: climber at the foot of the wall in a 3D valley" style="width:100%;border-radius:12px">
</a>
```

Notes
- The game needs a click inside the frame before the keyboard (WASD) works. That is normal browser behaviour for embedded pages.
- On phones it is playable by tapping holds, but it is designed for desktop (mouse and keyboard).
- The live site updates by itself on every push to `main`, so the portfolio never needs changing.
