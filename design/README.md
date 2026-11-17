# BitLess design library

Open **[index.html](index.html)** for the master design gallery. It includes the current review, all earlier HTML boards, and saved reference screens. It works as a local standalone file: study documents and local images are embedded, so no server or app connection is required. It is not an internet-hosted site.

The original HTML studies remain the editable source. The gallery preserves their original content and labels, including historical concepts superseded by current owner decisions. Appearance in the gallery does not indicate approval.

## Add or update designs

1. Save a study HTML under `design/`. Use relative local image paths where possible.
2. For named variants or screens, add a collection in `gallery-manifest.json`, following an existing entry. `selector` identifies the study's variant buttons; `pageSelector` identifies its screen buttons.
3. Run `python design/build-gallery.py` from the repository root.
4. Open `design/index.html` and check the affected previews. Review `gallery-build-report.json` for missing local image references.

Any HTML not explicitly listed in the manifest appears automatically under Earlier design boards or Saved reference screens when rebuilt. `index.html` and the gallery template are excluded from discovery. New files do not appear in an already-generated gallery until the rebuild runs.

`gallery-shell.html` is the gallery interface template; `index.html` is generated. Change the template rather than editing generated output. Each preview is isolated in a sandboxed frame. **Open full study** restores the original study controls and opens the selected variant/screen in its own tab.

Future design work in this repository should update this catalog and rebuild the master as part of delivery. Keep the user's floating + button preference and existing native/backend authorization boundaries intact.
