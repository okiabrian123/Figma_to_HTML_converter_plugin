(() => {
  // code.ts
  async function renderNode(node, assets, folderPath, parentAbs, siblings = []) {
    var _a;
    if (!node.visible) return "";
    const safeName = sanitizeName(node.name || node.type);
    const thisFolder = folderPath ? `${folderPath}/${safeName}` : sanitizeName(safeName);
    addToDesignTokens(node);
    const shouldExportWhole = (_a = layerPreferences.get(node.id)) != null ? _a : false;
    if (hasChildren(node)) {
      const yPos = node.absoluteTransform[1][2];
      figma.ui.postMessage({
        type: "log",
        text: `\u{1F3AF} Section "${node.name}" at Y: ${Math.round(yPos)}px (children: ${node.children.length})`
      });
    }
    if (hasChildren(node) && shouldExportWhole) {
      const containsImages = hasImageFills(node);
      const containsComplexEffects = hasComplexEffects(node);
      let result = null;
      if (!containsImages && !containsComplexEffects) {
        result = await optimizeImageExport(node, "SVG");
      }
      if (!result) {
        result = await optimizeImageExport(node, "PNG");
      }
      if (result) {
        const base = sanitizeName(safeName || "group");
        const file = uniqueName(thisFolder, base, result.ext);
        const fullPath = `assets/${thisFolder}/${file}`;
        assets.push({ path: fullPath, data: figma.base64Encode(result.bytes) });
        let styles = [`position: absolute`, `left: ${px(offsetWithinParent(node, parentAbs).x)}`, `top: ${px(offsetWithinParent(node, parentAbs).y)}`, `width: ${px(sizeOf(node).w)}`, `height: ${px(sizeOf(node).h)}`];
        styles = addZIndexIfNeeded(styles, node, siblings);
        return `<img src="${fullPath}" alt="${escapeHtml(node.name)}" style="${styles.join("; ")}">`;
      }
    }
    if ("layoutMode" in node && node.layoutMode !== "NONE") {
      const kids = hasChildren(node) ? await Promise.all(node.children.map((c) => renderNode(c, assets, thisFolder, node.absoluteTransform, node.children))) : [];
      return `<div style="display: flex; flex-direction: ${node.layoutMode === "VERTICAL" ? "column" : "row"}; width: ${px(sizeOf(node).w)}; height: ${px(sizeOf(node).h)};">${kids.join("")}</div>`;
    }
    if (node.type === "TEXT") {
      const textNode = node;
      const { x, y } = offsetWithinParent(node, parentAbs);
      const { w, h } = sizeOf(node);
      let baseStyles = [
        `position: absolute`,
        `left: ${px(x)}`,
        `top: ${px(y)}`,
        `width: ${px(w)}`,
        `height: ${px(h)}`,
        `display: flex`,
        `align-items: center`
      ];
      baseStyles = addZIndexIfNeeded(baseStyles, node, siblings);
      const textStyles = textNodeToCSS(textNode);
      const allStyles = [...baseStyles, textStyles].join("; ");
      const content = renderMixedTextContent(textNode);
      return `<div style="${allStyles}">${content}</div>`;
    }
    if (hasChildren(node)) {
      const { w, h } = sizeOf(node);
      let containerStyles = [`position: relative`, `width: ${px(w)}`, `height: ${px(h)}`];
      const bg = getBgColor(node);
      if (bg) containerStyles.push(`background: ${bg}`);
      containerStyles = addZIndexIfNeeded(containerStyles, node, siblings);
      const sortedChildren = sortChildrenByVisualOrder(node.children);
      const originalOrder = node.children.map((c, i) => `${i + 1}.${c.name}(Y:${Math.round(c.absoluteTransform[1][2])})`);
      const sortedOrder = sortedChildren.map((c, i) => `${i + 1}.${c.name}(Y:${Math.round(c.absoluteTransform[1][2])})`);
      figma.ui.postMessage({
        type: "log",
        text: `\u{1F4CB} Container "${node.name}" children sorting:
  Original Figma order: [${originalOrder.join(", ")}]
  Sorted by Y position: [${sortedOrder.join(", ")}]`
      });
      const kids = await Promise.all(
        sortedChildren.map((c) => renderNode(c, assets, thisFolder, node.absoluteTransform, sortedChildren))
      );
      return `<div style="${containerStyles.join("; ")}">${kids.join("")}</div>`;
    }
    if ("fills" in node && Array.isArray(node.fills)) {
      const imgFill = node.fills.find((f) => f.type === "IMAGE");
      if (imgFill) {
        const out = await exportFillImage(node, imgFill);
        if (out) {
          const base = sanitizeName(safeName || "image");
          const file = uniqueName(thisFolder, base, out.ext);
          const fullPath = `assets/${thisFolder}/${file}`;
          assets.push({ path: fullPath, data: figma.base64Encode(out.bytes) });
          let styles = styleAbsoluteBox(node, parentAbs).split("; ");
          styles = addZIndexIfNeeded(styles, node, siblings);
          figma.ui.postMessage({
            type: "log",
            text: `\u{1F5BC}\uFE0F Image fill "${node.name}" \u2192 <img> with proper crop/scale applied`
          });
          return `<img src="${fullPath}" alt="${escapeHtml(node.name)}" style="${styles.join("; ")}">`;
        }
      }
    }
    if (node.type === "ELLIPSE" && isSimpleEllipse(node)) {
      let styles = ellipseToDivCSS(node, parentAbs).split("; ");
      styles = addZIndexIfNeeded(styles, node, siblings);
      figma.ui.postMessage({
        type: "log",
        text: `\u2B55 Ellipse "${node.name}" \u2192 <div> with border-radius: 50%`
      });
      return `<div style="${styles.join("; ")}"></div>`;
    }
    if (node.type === "RECTANGLE" && isSimpleRectangle(node)) {
      let styles = rectangleToDivCSS(node, parentAbs).split("; ");
      styles = addZIndexIfNeeded(styles, node, siblings);
      figma.ui.postMessage({
        type: "log",
        text: `\u{1F3A8} Rectangle "${node.name}" \u2192 <div> with CSS (includes transforms & effects)`
      });
      return `<div style="${styles.join("; ")}"></div>`;
    }
    if (["VECTOR", "BOOLEAN_OPERATION", "RECTANGLE", "ELLIPSE", "POLYGON", "STAR", "LINE"].includes(node.type)) {
      const needsPng = hasImageFills(node) || hasComplexEffects(node);
      let result = null;
      if (!needsPng) {
        result = await optimizeImageExport(node, "SVG");
      }
      if (!result) {
        result = await optimizeImageExport(node, "PNG");
      }
      if (result) {
        const base = sanitizeName(safeName || "vector");
        const file = uniqueName(thisFolder, base, result.ext);
        const fullPath = `assets/${thisFolder}/${file}`;
        assets.push({ path: fullPath, data: figma.base64Encode(result.bytes) });
        let styles = styleAbsoluteBox(node, parentAbs).split("; ");
        styles = addZIndexIfNeeded(styles, node, siblings);
        return `<img src="${fullPath}" alt="${escapeHtml(node.name)}" style="${styles.join("; ")}">`;
      }
    }
    const fallback = await optimizeImageExport(node, "PNG");
    if (fallback) {
      const base = sanitizeName(safeName || "node");
      const file = uniqueName(thisFolder, base, fallback.ext);
      const fullPath = `assets/${thisFolder}/${file}`;
      assets.push({ path: fullPath, data: figma.base64Encode(fallback.bytes) });
      let styles = styleAbsoluteBox(node, parentAbs).split("; ");
      styles = addZIndexIfNeeded(styles, node, siblings);
      return `<img src="${fullPath}" alt="${escapeHtml(node.name)}" style="${styles.join("; ")}">`;
    }
    return "";
  }
  function htmlSkeleton(title, body, rootW, rootH) {
    const fontImports = generateFontImports();
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${fontImports}
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    body {
      margin: 0;
      background: #f3f4f6;
      font-feature-settings: "liga" 1, "kern" 1;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .canvas {
      position: relative;
      margin: 0 auto;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,.08);
      overflow: hidden;
    }
    /* Better text rendering */
    div[style*="font-"] {
      text-rendering: optimizeLegibility;
    }
  </style>
</head>
<body>
  <div class="canvas" style="width:${px(rootW)};height:${px(rootH)}">
    ${body}
  </div>
</body>
</html>`;
  }
  figma.showUI(__html__, { width: 480, height: 600 });
  figma.ui.onmessage = async (msg) => {
    var _a;
    if (!msg || !msg.type) return;
    if (msg.type === "close") {
      figma.closePlugin();
      return;
    }
    if (msg.type === "analyze") {
      const sel = figma.currentPage.selection.filter((n) => "width" in n && "height" in n);
      if (sel.length === 0) {
        figma.notify("Pilih Frame/Component terlebih dahulu.");
        figma.ui.postMessage({ type: "error", text: "Tidak ada selection. Pilih Frame/Component lalu klik Analyze." });
        return;
      }
      const analysis = [];
      for (const root of sel) {
        analysis.push(analyzeLayer(root));
      }
      figma.ui.postMessage({
        type: "analysis-result",
        layers: analysis
      });
      return;
    }
    if (msg.type === "export") {
      const sel = figma.currentPage.selection.filter((n) => "width" in n && "height" in n);
      if (sel.length === 0) {
        figma.ui.postMessage({ type: "error", text: "Tidak ada selection untuk di-export." });
        return;
      }
      layerPreferences.clear();
      if (msg.layerSettings) {
        for (const [id, shouldExportWhole] of Object.entries(msg.layerSettings)) {
          layerPreferences.set(id, shouldExportWhole);
        }
      }
      zIndexMap.clear();
      currentZIndex = 1;
      for (const root of sel) {
        usedFonts.clear();
        usedNamesPerFolder.clear();
        const assets = [];
        figma.ui.postMessage({
          type: "log",
          text: `\u{1F680} Starting export for "${root.name}" (${((_a = root.children) == null ? void 0 : _a.length) || 0} children)`
        });
        let childrenHtml = "";
        if (hasChildren(root)) {
          const sortedRootChildren = sortChildrenByVisualOrder(root.children);
          figma.ui.postMessage({
            type: "log",
            text: `\u{1F4CB} Root "${root.name}" final order: [${sortedRootChildren.map((c, i) => `${i + 1}.${c.name}(Y:${Math.round(c.absoluteTransform[1][2])})`).join(", ")}]`
          });
          const chunks = await Promise.all(sortedRootChildren.map((c) => renderNode(c, assets, sanitizeName(root.name), root.absoluteTransform, sortedRootChildren)));
          childrenHtml = chunks.join("");
        } else {
          childrenHtml = await renderNode(root, assets, sanitizeName(root.name), void 0);
        }
        const { w: rootW, h: rootH } = sizeOf(root);
        const html = htmlSkeleton(root.name, childrenHtml, rootW, rootH);
        let fullPngBase64 = null;
        try {
          const png = await root.exportAsync({ format: "PNG" });
          fullPngBase64 = figma.base64Encode(png);
        } catch (e) {
          fullPngBase64 = null;
        }
        figma.ui.postMessage({
          type: "zip",
          filename: `${sanitizeName(root.name)}.zip`,
          html,
          fullPng: fullPngBase64,
          assets
        });
        figma.ui.postMessage({
          type: "log",
          text: `\u2705 Export completed for "${root.name}" - HTML generated with ${assets.length} assets`
        });
      }
    }
  };
  function sanitizeName(name) {
    const trimmed = (name || "layer").trim();
    return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
  }
  function px(n) {
    return `${Math.round(n)}px`;
  }
  function colorToCss(paint) {
    var _a;
    const { r, g, b } = paint.color;
    const o = (_a = paint.opacity) != null ? _a : 1;
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${o})`;
  }
  function getBgColor(node) {
    if ("fills" in node && Array.isArray(node.fills) && node.fills.length > 0) {
      const fill = node.fills.find((f) => f.type === "SOLID");
      if (fill) return colorToCss(fill);
    }
    return null;
  }
  function escapeHtml(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  var usedFonts = /* @__PURE__ */ new Set();
  var designTokens = {
    colors: /* @__PURE__ */ new Map(),
    fonts: /* @__PURE__ */ new Map(),
    spacing: /* @__PURE__ */ new Set(),
    borderRadius: /* @__PURE__ */ new Set(),
    shadows: /* @__PURE__ */ new Set()
  };
  function addToDesignTokens(node) {
    if ("fills" in node && Array.isArray(node.fills)) {
      node.fills.forEach((fill) => {
        if (fill.type === "SOLID") {
          const colorValue = colorToCss(fill);
          const colorKey = `color-${designTokens.colors.size + 1}`;
          designTokens.colors.set(colorKey, colorValue);
        }
      });
    }
    if (node.type === "TEXT") {
      const textNode = node;
      const fontName = textNode.fontName;
      if (typeof fontName === "object" && "family" in fontName) {
        if (!designTokens.fonts.has(fontName.family)) {
          designTokens.fonts.set(fontName.family, {
            family: fontName.family,
            weights: /* @__PURE__ */ new Set()
          });
        }
        const fontWeight = textNode.fontWeight;
        if (typeof fontWeight === "number") {
          designTokens.fonts.get(fontName.family).weights.add(fontWeight);
        }
      }
    }
    const { w, h } = sizeOf(node);
    if (w > 0) designTokens.spacing.add(Math.round(w));
    if (h > 0) designTokens.spacing.add(Math.round(h));
    if ("cornerRadius" in node && node.cornerRadius) {
      if (typeof node.cornerRadius === "number") {
        designTokens.borderRadius.add(node.cornerRadius);
      } else if (Array.isArray(node.cornerRadius)) {
        node.cornerRadius.forEach((radius) => designTokens.borderRadius.add(radius));
      }
    }
    if ("effects" in node && node.effects) {
      node.effects.forEach((effect) => {
        var _a, _b, _c;
        if (effect.type === "DROP_SHADOW" && effect.visible !== false) {
          const x = ((_a = effect.offset) == null ? void 0 : _a.x) || 0;
          const y = ((_b = effect.offset) == null ? void 0 : _b.y) || 0;
          const blur = effect.radius || 0;
          const spread = effect.spread || 0;
          const { r, g, b } = effect.color;
          const opacity = (_c = effect.color.a) != null ? _c : 0.25;
          const shadowValue = `${px(x)} ${px(y)} ${px(blur)} ${px(spread)} rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${opacity})`;
          designTokens.shadows.add(shadowValue);
        }
      });
    }
    if (hasChildren(node)) {
      node.children.forEach((child) => addToDesignTokens(child));
    }
  }
  function isSimpleEllipse(node) {
    if (node.type !== "ELLIPSE") return false;
    if ("fills" in node && Array.isArray(node.fills)) {
      const hasImageFill = node.fills.some((f) => f.type === "IMAGE");
      if (hasImageFill) return false;
    }
    if ("fills" in node && Array.isArray(node.fills)) {
      const hasComplexGradient = node.fills.some(
        (f) => f.type === "GRADIENT_RADIAL" || f.type === "GRADIENT_DIAMOND" || f.type === "GRADIENT_ANGULAR"
      );
      if (hasComplexGradient) return false;
    }
    if ("effects" in node && node.effects && node.effects.length > 0) {
      const hasUnsupportedEffects = node.effects.some(
        (effect) => effect.type === "LAYER_BLUR" || effect.type === "BACKGROUND_BLUR" || effect.type === "INNER_SHADOW"
      );
      if (hasUnsupportedEffects) return false;
    }
    if (hasTransforms(node)) return false;
    return true;
  }
  function ellipseToCSS(node) {
    const styles = [];
    const { w, h } = sizeOf(node);
    if (w) styles.push(`width: ${px(w)}`);
    if (h) styles.push(`height: ${px(h)}`);
    styles.push("border-radius: 50%");
    const bg = getBgColor(node);
    if (bg) styles.push(`background: ${bg}`);
    if ("fills" in node && Array.isArray(node.fills)) {
      const gradientFill = node.fills.find((f) => f.type === "GRADIENT_LINEAR");
      if (gradientFill && gradientFill.gradientStops) {
        const stops = gradientFill.gradientStops.map((stop) => {
          var _a;
          const { r, g, b } = stop.color;
          const opacity = (_a = stop.color.a) != null ? _a : 1;
          return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${opacity}) ${Math.round(stop.position * 100)}%`;
        }).join(", ");
        const transform = gradientFill.gradientTransform;
        let angle = 0;
        if (transform) {
          angle = Math.atan2(transform[0][1], transform[0][0]) * (180 / Math.PI);
        }
        styles.push(`background: linear-gradient(${Math.round(angle)}deg, ${stops})`);
      }
    }
    if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.length > 0) {
      const stroke = node.strokes[0];
      if (stroke.type === "SOLID") {
        const strokeWidth = "strokeWeight" in node && node.strokeWeight ? node.strokeWeight : 1;
        const strokeColor = colorToCss(stroke);
        styles.push(`border: ${px(strokeWidth)} solid ${strokeColor}`);
      }
    }
    if ("effects" in node && node.effects && node.effects.length > 0) {
      const shadows = node.effects.filter((effect) => effect.type === "DROP_SHADOW" && effect.visible !== false).map((shadow) => {
        var _a, _b, _c;
        const x = ((_a = shadow.offset) == null ? void 0 : _a.x) || 0;
        const y = ((_b = shadow.offset) == null ? void 0 : _b.y) || 0;
        const blur = shadow.radius || 0;
        const spread = shadow.spread || 0;
        const { r, g, b } = shadow.color;
        const opacity = (_c = shadow.color.a) != null ? _c : 0.25;
        return `${px(x)} ${px(y)} ${px(blur)} ${px(spread)} rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${opacity})`;
      });
      if (shadows.length > 0) {
        styles.push(`box-shadow: ${shadows.join(", ")}`);
      }
    }
    if ("opacity" in node && node.opacity !== void 0 && node.opacity < 1) {
      styles.push(`opacity: ${node.opacity}`);
    }
    return styles.join("; ");
  }
  function ellipseToDivCSS(node, parentAbs) {
    const { x, y } = offsetWithinParent(node, parentAbs);
    const baseStyles = [`position: absolute`, `left: ${px(x)}`, `top: ${px(y)}`];
    const ellipseStyles = ellipseToCSS(node);
    return [...baseStyles, ellipseStyles].join("; ");
  }
  var zIndexMap = /* @__PURE__ */ new Map();
  var currentZIndex = 1;
  function calculateZIndex(node, siblings) {
    if (zIndexMap.has(node.id)) {
      return zIndexMap.get(node.id);
    }
    const index = siblings.indexOf(node);
    const zIndex = currentZIndex + index;
    zIndexMap.set(node.id, zIndex);
    return zIndex;
  }
  function addZIndexIfNeeded(styles, node, siblings) {
    if (siblings.length > 1) {
      const zIndex = calculateZIndex(node, siblings);
      return [...styles, `z-index: ${zIndex}`];
    }
    return styles;
  }
  async function optimizeImageExport(node, format = "PNG") {
    try {
      if (!canAttemptExport(node)) return null;
      const { w, h } = sizeOf(node);
      if (format === "SVG" && ["VECTOR", "RECTANGLE", "ELLIPSE", "POLYGON", "STAR"].includes(node.type)) {
        const svgBytes = await node.exportAsync({ format: "SVG" });
        if (svgBytes) {
          return { bytes: svgBytes, ext: "svg", optimized: true };
        }
      }
      const settings = { format: "PNG" };
      if (w <= 64 && h <= 64) {
        settings.constraint = { type: "SCALE", value: 2 };
      } else if (w > 512 || h > 512) {
        settings.constraint = { type: "SCALE", value: 1 };
      }
      const bytes = await node.exportAsync(settings);
      return { bytes, ext: "png", optimized: true };
    } catch (e) {
      return null;
    }
  }
  function fontToGoogleFont(fontName) {
    const fontMap = {
      "Inter": "Inter:wght@100;200;300;400;500;600;700;800;900",
      "Roboto": "Roboto:wght@100;300;400;500;700;900",
      "Open Sans": "Open+Sans:wght@300;400;500;600;700;800",
      "Poppins": "Poppins:wght@100;200;300;400;500;600;700;800;900",
      "Montserrat": "Montserrat:wght@100;200;300;400;500;600;700;800;900",
      "Nunito": "Nunito:wght@200;300;400;500;600;700;800;900",
      "Lato": "Lato:wght@100;300;400;700;900",
      "Source Sans Pro": "Source+Sans+Pro:wght@200;300;400;600;700;900",
      "Raleway": "Raleway:wght@100;200;300;400;500;600;700;800;900",
      "Playfair Display": "Playfair+Display:wght@400;500;600;700;800;900",
      "Merriweather": "Merriweather:wght@300;400;700;900",
      "Oswald": "Oswald:wght@200;300;400;500;600;700",
      "PT Sans": "PT+Sans:wght@400;700",
      "Ubuntu": "Ubuntu:wght@300;400;500;700",
      "Noto Sans": "Noto+Sans:wght@100;200;300;400;500;600;700;800;900"
    };
    return fontMap[fontName] || null;
  }
  function getFontFallback(fontName) {
    const serifFonts = ["Times", "Times New Roman", "Georgia", "Playfair Display", "Merriweather"];
    const monoFonts = ["Monaco", "Menlo", "Consolas", "Courier", "monospace"];
    if (serifFonts.some((f) => fontName.includes(f))) {
      return "serif";
    }
    if (monoFonts.some((f) => fontName.includes(f))) {
      return "monospace";
    }
    return "sans-serif";
  }
  function textNodeToCSS(node) {
    const styles = [];
    const textStyle = node.getRangeTextStyleId(0, 1);
    const fontName = node.fontName;
    let familyName = "";
    if (typeof fontName === "object" && "family" in fontName) {
      familyName = fontName.family;
    } else {
      const firstCharFont = node.getRangeFontName(0, 1);
      familyName = firstCharFont.family;
    }
    const googleFont = fontToGoogleFont(familyName);
    if (googleFont) {
      usedFonts.add(googleFont);
      styles.push(`font-family: "${familyName}", ${getFontFallback(familyName)}`);
    } else {
      styles.push(`font-family: "${familyName}", ${getFontFallback(familyName)}`);
    }
    const fontSize = node.fontSize;
    if (typeof fontSize === "number") {
      styles.push(`font-size: ${Math.round(fontSize)}px`);
    } else {
      const firstCharSize = node.getRangeFontSize(0, 1);
      styles.push(`font-size: ${Math.round(firstCharSize)}px`);
    }
    const fontWeight = node.fontWeight;
    if (typeof fontWeight === "number") {
      styles.push(`font-weight: ${fontWeight}`);
    } else {
      const firstCharWeight = node.getRangeFontWeight(0, 1);
      styles.push(`font-weight: ${firstCharWeight}`);
    }
    const fills = node.fills;
    if (fills && fills.length > 0) {
      const textFill = fills.find((f) => f.type === "SOLID");
      if (textFill) {
        const color = colorToCss(textFill);
        styles.push(`color: ${color}`);
      }
    }
    const lineHeight = node.lineHeight;
    if (lineHeight && typeof lineHeight === "object" && lineHeight.unit) {
      if (lineHeight.unit === "PIXELS") {
        styles.push(`line-height: ${Math.round(lineHeight.value)}px`);
      } else if (lineHeight.unit === "PERCENT") {
        styles.push(`line-height: ${(lineHeight.value / 100).toFixed(2)}`);
      }
    } else if (typeof lineHeight === "number") {
      styles.push(`line-height: ${lineHeight.toFixed(2)}`);
    }
    const letterSpacing = node.letterSpacing;
    if (letterSpacing && typeof letterSpacing === "object" && letterSpacing.unit) {
      if (letterSpacing.unit === "PIXELS") {
        styles.push(`letter-spacing: ${letterSpacing.value.toFixed(2)}px`);
      } else if (letterSpacing.unit === "PERCENT") {
        styles.push(`letter-spacing: ${(letterSpacing.value / 100).toFixed(3)}em`);
      }
    }
    const textAlign = node.textAlignHorizontal;
    if (textAlign && textAlign !== "LEFT") {
      styles.push(`text-align: ${textAlign.toLowerCase()}`);
    }
    const textDecoration = node.textDecoration;
    if (textDecoration && textDecoration !== "NONE") {
      styles.push(`text-decoration: ${textDecoration.toLowerCase()}`);
    }
    const textCase = node.textCase;
    if (textCase && textCase !== "ORIGINAL") {
      const caseMap = {
        "UPPER": "uppercase",
        "LOWER": "lowercase",
        "TITLE": "capitalize"
      };
      if (caseMap[textCase]) {
        styles.push(`text-transform: ${caseMap[textCase]}`);
      }
    }
    return styles.join("; ");
  }
  function renderMixedTextContent(node) {
    const text = node.characters;
    const length = text.length;
    if (length === 0) return "";
    let hasMixedStyling = false;
    const firstFont = node.getRangeFontName(0, 1);
    const firstSize = node.getRangeFontSize(0, 1);
    const firstWeight = node.getRangeFontWeight(0, 1);
    for (let i = 1; i < length; i++) {
      const font = node.getRangeFontName(i, i + 1);
      const size = node.getRangeFontSize(i, i + 1);
      const weight = node.getRangeFontWeight(i, i + 1);
      if (font.family !== firstFont.family || font.style !== firstFont.style || size !== firstSize || weight !== firstWeight) {
        hasMixedStyling = true;
        break;
      }
    }
    if (!hasMixedStyling) {
      return escapeHtml(text);
    }
    const segments = [];
    let currentStart = 0;
    for (let i = 1; i <= length; i++) {
      const needsSplit = i === length || (() => {
        const currentFont = node.getRangeFontName(i - 1, i);
        const nextFont = node.getRangeFontName(i, i + 1);
        const currentSize = node.getRangeFontSize(i - 1, i);
        const nextSize = node.getRangeFontSize(i, i + 1);
        const currentWeight = node.getRangeFontWeight(i - 1, i);
        const nextWeight = node.getRangeFontWeight(i, i + 1);
        return currentFont.family !== nextFont.family || currentFont.style !== nextFont.style || currentSize !== nextSize || currentWeight !== nextWeight;
      })();
      if (needsSplit) {
        const segmentText = text.slice(currentStart, i);
        const font = node.getRangeFontName(currentStart, currentStart + 1);
        const size = node.getRangeFontSize(currentStart, currentStart + 1);
        const weight = node.getRangeFontWeight(currentStart, currentStart + 1);
        const segmentStyles = [];
        const googleFont = fontToGoogleFont(font.family);
        if (googleFont) {
          usedFonts.add(googleFont);
        }
        segmentStyles.push(`font-family: "${font.family}", ${getFontFallback(font.family)}`);
        segmentStyles.push(`font-size: ${Math.round(size)}px`);
        segmentStyles.push(`font-weight: ${weight}`);
        segments.push({
          text: segmentText,
          styles: segmentStyles.join("; ")
        });
        currentStart = i;
      }
    }
    return segments.map(
      (segment) => `<span style="${segment.styles}">${escapeHtml(segment.text)}</span>`
    ).join("");
  }
  function generateFontImports() {
    if (usedFonts.size === 0) return "";
    const fontUrls = Array.from(usedFonts).map(
      (font) => `https://fonts.googleapis.com/css2?family=${font}&display=swap`
    );
    return fontUrls.map(
      (url) => `<link href="${url}" rel="stylesheet">`
    ).join("\n    ");
  }
  function hasChildren(n) {
    return "children" in n && Array.isArray(n.children);
  }
  function sizeOf(node) {
    var _a, _b;
    const w = (_a = node.width) != null ? _a : 0;
    const h = (_b = node.height) != null ? _b : 0;
    return { w, h };
  }
  function offsetWithinParent(node, parentAbs) {
    if (!parentAbs) return { x: 0, y: 0 };
    const a = node.absoluteTransform;
    const x = a[0][2] - parentAbs[0][2];
    const y = a[1][2] - parentAbs[1][2];
    return { x, y };
  }
  function detectImageExt(bytes) {
    if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "png";
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
    if (bytes.length >= 12 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) return "webp";
    if (bytes.length >= 6 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return "gif";
    return "unknown";
  }
  function canAttemptExport(node) {
    if (!("visible" in node) || !node.visible) return false;
    if ("opacity" in node && node.opacity === 0) return false;
    const { w, h } = sizeOf(node);
    if (w === 0 || h === 0) return false;
    return true;
  }
  async function tryExportNodeImage(node, fmt = "PNG") {
    try {
      if (!canAttemptExport(node)) return null;
      return await node.exportAsync({ format: fmt });
    } catch (e) {
      return null;
    }
  }
  async function exportFillImage(node, fill) {
    try {
      if (!(fill == null ? void 0 : fill.imageHash)) return null;
      figma.ui.postMessage({
        type: "log",
        text: `\u{1F4F8} Exporting image fill for "${node.name}" - always use node export for proper crop/scale`
      });
      const editedBytes = await tryExportNodeImage(node, "PNG");
      if (editedBytes) {
        return { bytes: editedBytes, ext: "png" };
      }
      figma.ui.postMessage({
        type: "log",
        text: `\u26A0\uFE0F Node export failed for "${node.name}", falling back to raw image (may not match design)`
      });
      const img = figma.getImageByHash(fill.imageHash);
      const bytes = await img.getBytesAsync();
      const ext = detectImageExt(bytes);
      return { bytes, ext: ext === "unknown" ? "png" : ext };
    } catch (e) {
      figma.ui.postMessage({
        type: "log",
        text: `\u274C Failed to export image for "${node.name}": ${e}`
      });
      return null;
    }
  }
  function hasTransforms(node) {
    if (!("absoluteTransform" in node)) return false;
    const transform = node.absoluteTransform;
    const a = transform[0][0];
    const b = transform[0][1];
    const c = transform[1][0];
    const d = transform[1][1];
    const hasRotation = Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3;
    const hasScaling = Math.abs(a - 1) > 1e-3 || Math.abs(d - 1) > 1e-3;
    return hasRotation || hasScaling;
  }
  function hasImageFills(node) {
    if ("fills" in node && Array.isArray(node.fills)) {
      const hasImgFill = node.fills.some((f) => f.type === "IMAGE");
      if (hasImgFill) return true;
    }
    if (hasChildren(node)) {
      return node.children.some((child) => hasImageFills(child));
    }
    return false;
  }
  function isMergedShape(node) {
    var _a;
    if (node.type === "BOOLEAN_OPERATION") return true;
    if (node.type === "RECTANGLE" && hasChildren(node)) {
      const hasVectorChildren = (_a = node.children) == null ? void 0 : _a.some(
        (child) => ["VECTOR", "RECTANGLE", "ELLIPSE", "POLYGON", "STAR"].includes(child.type)
      );
      return hasVectorChildren;
    }
    return false;
  }
  function transformToCSS(node) {
    if (!("absoluteTransform" in node)) return "";
    const transform = node.absoluteTransform;
    const transforms = [];
    const a = transform[0][0];
    const b = transform[0][1];
    const c = transform[1][0];
    const d = transform[1][1];
    const rotation = Math.atan2(b, a) * (180 / Math.PI);
    if (Math.abs(rotation) > 0.1) {
      transforms.push(`rotate(${rotation.toFixed(2)}deg)`);
    }
    const scaleX = Math.sqrt(a * a + b * b);
    const scaleY = Math.sqrt(c * c + d * d);
    if (Math.abs(scaleX - 1) > 1e-3 || Math.abs(scaleY - 1) > 1e-3) {
      if (Math.abs(scaleX - scaleY) < 1e-3) {
        transforms.push(`scale(${scaleX.toFixed(3)})`);
      } else {
        transforms.push(`scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`);
      }
    }
    return transforms.length > 0 ? transforms.join(" ") : "";
  }
  function effectsToCSS(node) {
    var _a, _b, _c, _d, _e, _f;
    const filters = [];
    const shadows = [];
    const backdropFilters = [];
    if (!("effects" in node) || !node.effects) {
      return { filter: "", boxShadow: "", backdropFilter: "" };
    }
    for (const effect of node.effects) {
      if (!effect.visible) continue;
      switch (effect.type) {
        case "LAYER_BLUR":
          if (effect.radius > 0) {
            filters.push(`blur(${effect.radius}px)`);
          }
          break;
        case "BACKGROUND_BLUR":
          if (effect.radius > 0) {
            backdropFilters.push(`blur(${effect.radius}px)`);
          }
          break;
        case "DROP_SHADOW":
          const x = ((_a = effect.offset) == null ? void 0 : _a.x) || 0;
          const y = ((_b = effect.offset) == null ? void 0 : _b.y) || 0;
          const blur = effect.radius || 0;
          const spread = effect.spread || 0;
          const { r, g, b } = effect.color;
          const opacity = (_c = effect.color.a) != null ? _c : 0.25;
          shadows.push(`${px(x)} ${px(y)} ${px(blur)} ${px(spread)} rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${opacity})`);
          break;
        case "INNER_SHADOW":
          const ix = ((_d = effect.offset) == null ? void 0 : _d.x) || 0;
          const iy = ((_e = effect.offset) == null ? void 0 : _e.y) || 0;
          const iblur = effect.radius || 0;
          const ispread = effect.spread || 0;
          const { r: ir, g: ig, b: ib } = effect.color;
          const iopacity = (_f = effect.color.a) != null ? _f : 0.25;
          shadows.push(`inset ${px(ix)} ${px(iy)} ${px(iblur)} ${px(ispread)} rgba(${Math.round(ir * 255)}, ${Math.round(ig * 255)}, ${Math.round(ib * 255)}, ${iopacity})`);
          break;
      }
    }
    return {
      filter: filters.length > 0 ? filters.join(" ") : "",
      boxShadow: shadows.length > 0 ? shadows.join(", ") : "",
      backdropFilter: backdropFilters.length > 0 ? backdropFilters.join(" ") : ""
    };
  }
  function isSimpleRectangle(node) {
    if (node.type !== "RECTANGLE") return false;
    if (isMergedShape(node)) return false;
    if ("fills" in node && Array.isArray(node.fills)) {
      const hasImageFill = node.fills.some((f) => f.type === "IMAGE");
      if (hasImageFill) return false;
    }
    return true;
  }
  function rectangleToCSS(node) {
    const styles = [];
    const { w, h } = sizeOf(node);
    if (w) styles.push(`width:${px(w)}`);
    if (h) styles.push(`height:${px(h)}`);
    const bg = getBgColor(node);
    if (bg) styles.push(`background:${bg}`);
    if ("fills" in node && Array.isArray(node.fills)) {
      const gradientFill = node.fills.find((f) => f.type === "GRADIENT_LINEAR");
      if (gradientFill && gradientFill.gradientStops) {
        const stops = gradientFill.gradientStops.map((stop) => {
          var _a;
          const { r, g, b } = stop.color;
          const opacity = (_a = stop.color.a) != null ? _a : 1;
          return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${opacity}) ${Math.round(stop.position * 100)}%`;
        }).join(", ");
        const transform = gradientFill.gradientTransform;
        let angle = 0;
        if (transform) {
          angle = Math.atan2(transform[0][1], transform[0][0]) * (180 / Math.PI);
        }
        styles.push(`background:linear-gradient(${Math.round(angle)}deg, ${stops})`);
      }
    }
    if ("cornerRadius" in node && node.cornerRadius) {
      if (typeof node.cornerRadius === "number") {
        styles.push(`border-radius:${px(node.cornerRadius)}`);
      } else if (Array.isArray(node.cornerRadius)) {
        const [tl, tr, br, bl] = node.cornerRadius;
        styles.push(`border-radius:${px(tl)} ${px(tr)} ${px(br)} ${px(bl)}`);
      }
    }
    if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.length > 0) {
      const stroke = node.strokes[0];
      if (stroke.type === "SOLID") {
        const strokeWidth = "strokeWeight" in node && node.strokeWeight ? node.strokeWeight : 1;
        const strokeColor = colorToCss(stroke);
        styles.push(`border:${px(strokeWidth)} solid ${strokeColor}`);
      }
    }
    const transformCSS = transformToCSS(node);
    if (transformCSS) {
      styles.push(`transform:${transformCSS}`);
      styles.push(`transform-origin:center center`);
    }
    const { filter, boxShadow, backdropFilter } = effectsToCSS(node);
    if (filter) styles.push(`filter:${filter}`);
    if (boxShadow) styles.push(`box-shadow:${boxShadow}`);
    if (backdropFilter) styles.push(`backdrop-filter:${backdropFilter}`);
    if ("opacity" in node && node.opacity !== void 0 && node.opacity < 1) {
      styles.push(`opacity:${node.opacity}`);
    }
    return styles.join("; ");
  }
  function rectangleToDivCSS(node, parentAbs) {
    const { x, y } = offsetWithinParent(node, parentAbs);
    const baseStyles = [`position:absolute`, `left:${px(x)}`, `top:${px(y)}`];
    const rectStyles = rectangleToCSS(node);
    return [...baseStyles, rectStyles].join("; ");
  }
  function hasComplexEffects(node) {
    if ("opacity" in node && node.opacity !== void 0 && node.opacity < 0.05) {
      return true;
    }
    if (hasChildren(node)) {
      return node.children.some((child) => hasComplexEffects(child));
    }
    return false;
  }
  function detectGroupType(node) {
    var _a;
    if (!hasChildren(node)) return "simple";
    const children = node.children;
    const name = ((_a = node.name) == null ? void 0 : _a.toLowerCase()) || "";
    const logoKeywords = ["logo", "brand", "icon", "symbol", "mark"];
    const hasLogoName = logoKeywords.some((keyword) => name.includes(keyword));
    const hasComplexTransforms = hasTransforms(node);
    const shapeTypes = ["VECTOR", "BOOLEAN_OPERATION", "RECTANGLE", "ELLIPSE", "POLYGON", "STAR"];
    const shapeCount = children.filter((child) => shapeTypes.includes(child.type)).length;
    const textCount = children.filter((child) => child.type === "TEXT").length;
    if ("layoutMode" in node && node.layoutMode !== "NONE") {
      return "layout";
    }
    if (hasLogoName || hasComplexTransforms) return "logo";
    if (shapeCount >= 2 && children.length <= 5) return "logo";
    if (shapeCount > 0 && textCount > 0 && children.length <= 4) return "logo";
    if (children.length > 1 && children.length <= 8) return "component";
    return "simple";
  }
  function analyzeLayer(node, path = "") {
    const currentPath = path ? `${path} > ${node.name}` : node.name;
    const groupType = detectGroupType(node);
    const info = {
      id: node.id,
      name: node.name || node.type,
      type: node.type,
      groupType,
      shouldExportWhole: groupType === "logo",
      // Default: logo = export whole
      path: currentPath,
      node
    };
    if (hasChildren(node)) {
      info.children = node.children.filter((child) => child.visible).map((child) => analyzeLayer(child, currentPath));
    }
    return info;
  }
  var usedNamesPerFolder = /* @__PURE__ */ new Map();
  function uniqueName(folder, base, ext) {
    const map = usedNamesPerFolder.get(folder) || {};
    const key = `${base}.${ext}`;
    let name = key;
    if (map[key] != null) {
      map[key] += 1;
      name = `${base}_${map[key]}.${ext}`;
    } else {
      map[key] = 0;
    }
    usedNamesPerFolder.set(folder, map);
    return name;
  }
  function styleAbsoluteBox(node, parentAbs) {
    const { x, y } = offsetWithinParent(node, parentAbs);
    const { w, h } = sizeOf(node);
    const parts = [`position:absolute`, `left:${px(x)}`, `top:${px(y)}`, `width:${px(w)}`, `height:${px(h)}`];
    const bg = getBgColor(node);
    if (bg) parts.push(`background:${bg}`);
    return parts.join("; ");
  }
  var layerPreferences = /* @__PURE__ */ new Map();
  function sortChildrenByVisualOrder(children, parentTransform) {
    return children.slice().sort((a, b) => {
      let aY = a.absoluteTransform[1][2];
      let bY = b.absoluteTransform[1][2];
      figma.ui.postMessage({
        type: "log",
        text: `\u{1F504} Sorting: "${a.name}" (Y:${Math.round(aY)}) vs "${b.name}" (Y:${Math.round(bY)})`
      });
      if (Math.abs(aY - bY) > 10) {
        return aY - bY;
      }
      let aX = a.absoluteTransform[0][2];
      let bX = b.absoluteTransform[0][2];
      return aX - bX;
    });
  }
})();
