// Updated renderNode function dengan debug info yang lebih baik dan fix sorting
async function renderNode(
  node: SceneNode,
  assets: AssetOut[],
  folderPath: string,
  parentAbs?: Transform,
  siblings: SceneNode[] = []
): Promise<string> {
  if (!node.visible) return "";

  const safeName = sanitizeName(node.name || node.type);
  const thisFolder = folderPath ? `${folderPath}/${safeName}` : sanitizeName(safeName);

  // Collect design tokens
  addToDesignTokens(node);

  // Cek user preference untuk node ini
  const shouldExportWhole = layerPreferences.get(node.id) ?? false;

  // Debug: Log position for major sections with more detail
  if (hasChildren(node)) {
    const yPos = node.absoluteTransform[1][2];
    figma.ui.postMessage({ 
      type: "log", 
      text: `🎯 Section "${node.name}" at Y: ${Math.round(yPos)}px (children: ${node.children.length})` 
    });
  }

  // Jika user pilih export whole, langsung export sebagai gambar
  if (hasChildren(node) && shouldExportWhole) {
    const containsImages = hasImageFills(node);
    const containsComplexEffects = hasComplexEffects(node);
    
    let result = null;
    
    // Try optimized export
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
      
      return `<img src="${fullPath}" alt="${escapeHtml(node.name)}" style="${styles.join('; ')}">`;
    }
  }

  // AUTO LAYOUT → Flexbox container
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    // ... existing auto layout code ...
    const kids = hasChildren(node) ? 
      await Promise.all(node.children.map(c => renderNode(c, assets, thisFolder, node.absoluteTransform, node.children))) : [];
    
    return `<div style="display: flex; flex-direction: ${node.layoutMode === "VERTICAL" ? "column" : "row"}; width: ${px(sizeOf(node).w)}; height: ${px(sizeOf(node).h)};">${kids.join("")}</div>`;
  }

  // TEXT node → div dengan styling lengkap
  if (node.type === "TEXT") {
    const textNode = node as TextNode;
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
    const allStyles = [...baseStyles, textStyles].join('; ');
    const content = renderMixedTextContent(textNode);
    
    return `<div style="${allStyles}">${content}</div>`;
  }

  // Container non-auto layout → relative + children absolute
  if (hasChildren(node)) {
    const { w, h } = sizeOf(node);
    let containerStyles = [`position: relative`, `width: ${px(w)}`, `height: ${px(h)}`];
    
    const bg = getBgColor(node);
    if (bg) containerStyles.push(`background: ${bg}`);
    
    containerStyles = addZIndexIfNeeded(containerStyles, node, siblings);
    
    // CRITICAL FIX: Use correct sorting with absolute positions
    const sortedChildren = sortChildrenByVisualOrder(node.children);
    
    // Enhanced debug logging
    const originalOrder = node.children.map((c, i) => `${i+1}.${c.name}(Y:${Math.round(c.absoluteTransform[1][2])})`);
    const sortedOrder = sortedChildren.map((c, i) => `${i+1}.${c.name}(Y:${Math.round(c.absoluteTransform[1][2])})`);
    
    figma.ui.postMessage({ 
      type: "log", 
      text: `📋 Container "${node.name}" children sorting:\n  Original Figma order: [${originalOrder.join(', ')}]\n  Sorted by Y position: [${sortedOrder.join(', ')}]` 
    });
    
    const kids = await Promise.all(
      sortedChildren.map(c => renderNode(c, assets, thisFolder, node.absoluteTransform, sortedChildren))
    );
    
    return `<div style="${containerStyles.join('; ')}">${kids.join("")}</div>`;
  }
  
  // Image dari FILL
  if ("fills" in node && Array.isArray(node.fills)) {
    const imgFill = node.fills.find(f => f.type === "IMAGE") as ImagePaint | undefined;
    if (imgFill) {
      const out = await exportFillImage(node, imgFill);
      if (out) {
        const base = sanitizeName(safeName || "image");
        const file = uniqueName(thisFolder, base, out.ext);
        const fullPath = `assets/${thisFolder}/${file}`;
        assets.push({ path: fullPath, data: figma.base64Encode(out.bytes) });
        
        let styles = styleAbsoluteBox(node, parentAbs).split('; ');
        styles = addZIndexIfNeeded(styles, node, siblings);
        
        figma.ui.postMessage({ 
          type: "log", 
          text: `🖼️ Image fill "${node.name}" → <img> with proper crop/scale applied` 
        });
        
        return `<img src="${fullPath}" alt="${escapeHtml(node.name)}" style="${styles.join('; ')}">`;
      }
    }
  }

  // ELLIPSE → Convert ke DIV dengan CSS jika simple
  if (node.type === "ELLIPSE" && isSimpleEllipse(node)) {
    let styles = ellipseToDivCSS(node, parentAbs).split('; ');
    styles = addZIndexIfNeeded(styles, node, siblings);
    
    figma.ui.postMessage({ 
      type: "log", 
      text: `⭕ Ellipse "${node.name}" → <div> with border-radius: 50%` 
    });
    
    return `<div style="${styles.join('; ')}"></div>`;
  }

  // RECTANGLE → Convert ke DIV dengan CSS jika simple  
  if (node.type === "RECTANGLE" && isSimpleRectangle(node)) {
    let styles = rectangleToDivCSS(node, parentAbs).split('; ');
    styles = addZIndexIfNeeded(styles, node, siblings);
    
    figma.ui.postMessage({ 
      type: "log", 
      text: `🎨 Rectangle "${node.name}" → <div> with CSS (includes transforms & effects)` 
    });
    
    return `<div style="${styles.join('; ')}"></div>`;
  }
  
  // Vector / shape → optimized export
  if (["VECTOR","BOOLEAN_OPERATION","RECTANGLE","ELLIPSE","POLYGON","STAR","LINE"].includes(node.type)) {
    const needsPng = hasImageFills(node) || hasComplexEffects(node);
    
    let result = null;
    
    // Try SVG for simple vectors
    if (!needsPng) {
      result = await optimizeImageExport(node, "SVG");
    }
    
    // Fallback to PNG
    if (!result) {
      result = await optimizeImageExport(node, "PNG");
    }
    
    if (result) {
      const base = sanitizeName(safeName || "vector");
      const file = uniqueName(thisFolder, base, result.ext);
      const fullPath = `assets/${thisFolder}/${file}`;
      assets.push({ path: fullPath, data: figma.base64Encode(result.bytes) });
      
      let styles = styleAbsoluteBox(node, parentAbs).split('; ');
      styles = addZIndexIfNeeded(styles, node, siblings);
      
      return `<img src="${fullPath}" alt="${escapeHtml(node.name)}" style="${styles.join('; ')}">`;
    }
  }

  // Fallback export PNG
  const fallback = await optimizeImageExport(node, "PNG");
  if (fallback) {
    const base = sanitizeName(safeName || "node");
    const file = uniqueName(thisFolder, base, fallback.ext);
    const fullPath = `assets/${thisFolder}/${file}`;
    assets.push({ path: fullPath, data: figma.base64Encode(fallback.bytes) });
    
    let styles = styleAbsoluteBox(node, parentAbs).split('; ');
    styles = addZIndexIfNeeded(styles, node, siblings);
    
    return `<img src="${fullPath}" alt="${escapeHtml(node.name)}" style="${styles.join('; ')}">`;
  }

  return "";
}

function htmlSkeleton(title: string, body: string, rootW: number, rootH: number) {
  // Generate Google Fonts imports
  const fontImports = generateFontImports();
  
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${fontImports}
  <script src="https://cdn.tailwindcss.com"></script>
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

// ---------- Main flow ----------
figma.showUI(__html__, { width: 480, height: 600 });

figma.ui.onmessage = async (msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === "close") { figma.closePlugin(); return; }
  
  if (msg.type === "analyze") {
    const sel = figma.currentPage.selection.filter(n => "width" in n && "height" in n) as SceneNode[];
    if (sel.length === 0) {
      figma.notify("Pilih Frame/Component terlebih dahulu.");
      figma.ui.postMessage({ type: "error", text: "Tidak ada selection. Pilih Frame/Component lalu klik Analyze." });
      return;
    }

    // Analyze setiap selected frame
    const analysis: LayerInfo[] = [];
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
    const sel = figma.currentPage.selection.filter(n => "width" in n && "height" in n) as SceneNode[];
    if (sel.length === 0) {
      figma.ui.postMessage({ type: "error", text: "Tidak ada selection untuk di-export." });
      return;
    }

    // Set layer preferences dari UI
    layerPreferences.clear();
    if (msg.layerSettings) {
      for (const [id, shouldExportWhole] of Object.entries(msg.layerSettings)) {
        layerPreferences.set(id, shouldExportWhole as boolean);
      }
    }

    // Reset z-index tracking untuk setiap export
    zIndexMap.clear();
    currentZIndex = 1;

    // Export
    for (const root of sel) {
      // Reset font tracking untuk setiap export
      usedFonts.clear();
      usedNamesPerFolder.clear();
      const assets: AssetOut[] = [];
      
      figma.ui.postMessage({ 
        type: "log", 
        text: `🚀 Starting export for "${root.name}" (${root.children?.length || 0} children)` 
      });
      
      let childrenHtml = "";
      if (hasChildren(root)) {
        // CRITICAL: Sort root children by visual order first
        const sortedRootChildren = sortChildrenByVisualOrder(root.children);
        
        figma.ui.postMessage({ 
          type: "log", 
          text: `📋 Root "${root.name}" final order: [${sortedRootChildren.map((c, i) => `${i+1}.${c.name}(Y:${Math.round(c.absoluteTransform[1][2])})`).join(', ')}]` 
        });
        
        const chunks = await Promise.all(sortedRootChildren.map(c => renderNode(c, assets, sanitizeName(root.name), root.absoluteTransform, sortedRootChildren)));
        childrenHtml = chunks.join("");
      } else {
        childrenHtml = await renderNode(root, assets, sanitizeName(root.name), undefined);
      }

      const { w: rootW, h: rootH } = sizeOf(root);
      const html = htmlSkeleton(root.name, childrenHtml, rootW, rootH);

      // Full screenshot
      let fullPngBase64: string | null = null;
      try {
        const png = await (root as any).exportAsync({ format: "PNG" });
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
        text: `✅ Export completed for "${root.name}" - HTML generated with ${assets.length} assets` 
      });
    }
  }
};
// ---------- Helpers ----------
function sanitizeName(name: string): string {
  const trimmed = (name || "layer").trim();
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function px(n: number) { return `${Math.round(n)}px`; }

function colorToCss(paint: SolidPaint): string {
  const { r, g, b } = paint.color;
  const o = paint.opacity ?? 1;
  return `rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, ${o})`;
}

function getBgColor(node: SceneNode) {
  if ("fills" in node && Array.isArray(node.fills) && node.fills.length > 0) {
    const fill = node.fills.find(f => f.type === "SOLID") as SolidPaint | undefined;
    if (fill) return colorToCss(fill);
  }
  return null;
}

function escapeHtml(s: string) {
  return (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ---------- Text & Font Handling ----------

// ---------- Design Tokens & CSS Variables ----------

// Track used fonts for Google Fonts loading
const usedFonts = new Set<string>();

const designTokens = {
  colors: new Map<string, string>(),
  fonts: new Map<string, { family: string; weights: Set<number> }>(),
  spacing: new Set<number>(),
  borderRadius: new Set<number>(),
  shadows: new Set<string>()
};

function addToDesignTokens(node: SceneNode) {
  // Extract colors
  if ("fills" in node && Array.isArray(node.fills)) {
    node.fills.forEach(fill => {
      if (fill.type === "SOLID") {
        const colorValue = colorToCss(fill);
        const colorKey = `color-${designTokens.colors.size + 1}`;
        designTokens.colors.set(colorKey, colorValue);
      }
    });
  }
  
  // Extract fonts (for TEXT nodes)
  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    const fontName = textNode.fontName as FontName;
    if (typeof fontName === 'object' && 'family' in fontName) {
      if (!designTokens.fonts.has(fontName.family)) {
        designTokens.fonts.set(fontName.family, { 
          family: fontName.family, 
          weights: new Set() 
        });
      }
      const fontWeight = textNode.fontWeight as number;
      if (typeof fontWeight === 'number') {
        designTokens.fonts.get(fontName.family)!.weights.add(fontWeight);
      }
    }
  }
  
  // Extract spacing (widths, heights, gaps)
  const { w, h } = sizeOf(node);
  if (w > 0) designTokens.spacing.add(Math.round(w));
  if (h > 0) designTokens.spacing.add(Math.round(h));
  
  // Extract border radius
  if ("cornerRadius" in node && node.cornerRadius) {
    if (typeof node.cornerRadius === "number") {
      designTokens.borderRadius.add(node.cornerRadius);
    } else if (Array.isArray(node.cornerRadius)) {
      node.cornerRadius.forEach(radius => designTokens.borderRadius.add(radius));
    }
  }
  
  // Extract shadows
  if ("effects" in node && node.effects) {
    node.effects.forEach(effect => {
      if (effect.type === "DROP_SHADOW" && effect.visible !== false) {
        const x = effect.offset?.x || 0;
        const y = effect.offset?.y || 0;
        const blur = effect.radius || 0;
        const spread = effect.spread || 0;
        const { r, g, b } = effect.color;
        const opacity = effect.color.a ?? 0.25;
        const shadowValue = `${px(x)} ${px(y)} ${px(blur)} ${px(spread)} rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, ${opacity})`;
        designTokens.shadows.add(shadowValue);
      }
    });
  }
  
  // Recursively collect from children
  if (hasChildren(node)) {
    (node as any).children.forEach((child: SceneNode) => addToDesignTokens(child));
  }
}

function generateCSSVariables(): string {
  const cssVars: string[] = [':root {'];
  
  // Colors
  let colorIndex = 1;
  designTokens.colors.forEach((value, key) => {
    cssVars.push(`  --color-${colorIndex}: ${value};`);
    colorIndex++;
  });
  
  // Fonts
  designTokens.fonts.forEach((fontData, family) => {
    const safeName = family.toLowerCase().replace(/\s+/g, '-');
    cssVars.push(`  --font-${safeName}: "${family}", ${getFontFallback(family)};`);
  });
  
  // Spacing (most common ones)
  const commonSpacing = Array.from(designTokens.spacing)
    .sort((a, b) => a - b)
    .slice(0, 20); // Top 20 most used
  commonSpacing.forEach((spacing, index) => {
    cssVars.push(`  --spacing-${index + 1}: ${spacing}px;`);
  });
  
  // Border radius
  const commonRadius = Array.from(designTokens.borderRadius)
    .sort((a, b) => a - b);
  commonRadius.forEach((radius, index) => {
    cssVars.push(`  --radius-${index + 1}: ${radius}px;`);
  });
  
  // Shadows
  let shadowIndex = 1;
  designTokens.shadows.forEach(shadow => {
    cssVars.push(`  --shadow-${shadowIndex}: ${shadow};`);
    shadowIndex++;
  });
  
  cssVars.push('}');
  return cssVars.join('\n');
}

// ---------- Component Detection & CSS Classes ----------

const componentClasses = new Map<string, { selector: string; styles: string; nodes: SceneNode[] }>();

function detectReusableComponents(node: SceneNode, allNodes: SceneNode[]) {
  // Skip if not a potential component
  if (!hasChildren(node) || (node as any).children.length === 0) return;
  
  // Create a signature for this node structure
  const signature = createNodeSignature(node);
  
  // Find similar nodes
  const similarNodes = allNodes.filter(otherNode => 
    otherNode.id !== node.id && 
    createNodeSignature(otherNode) === signature
  );
  
  if (similarNodes.length > 0) {
    const className = `component-${sanitizeName(node.name).toLowerCase()}`;
    const styles = generateComponentCSS(node);
    
    componentClasses.set(signature, {
      selector: `.${className}`,
      styles,
      nodes: [node, ...similarNodes]
    });
  }
}

function createNodeSignature(node: SceneNode): string {
  if (!hasChildren(node)) return `${node.type}`;
  
  const children = (node as any).children as SceneNode[];
  const childSignatures = children.map(child => `${child.type}:${child.name || ''}`);
  const { w, h } = sizeOf(node);
  
  return `${node.type}:${Math.round(w)}x${Math.round(h)}:[${childSignatures.join(',')}]`;
}

function generateComponentCSS(node: SceneNode): string {
  const styles: string[] = [];
  
  // Base container styles
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    styles.push('display: flex');
    styles.push(node.layoutMode === "VERTICAL" ? 'flex-direction: column' : 'flex-direction: row');
    
    const gap = node.itemSpacing ?? 0;
    if (gap > 0) styles.push(`gap: ${px(gap)}`);
    
    // Padding
    const pT = node.paddingTop ?? 0, pR = node.paddingRight ?? 0, 
          pB = node.paddingBottom ?? 0, pL = node.paddingLeft ?? 0;
    if (pT || pR || pB || pL) {
      styles.push(`padding: ${px(pT)} ${px(pR)} ${px(pB)} ${px(pL)}`);
    }
  } else {
    styles.push('position: relative');
  }
  
  // Size
  const { w, h } = sizeOf(node);
  styles.push(`width: ${px(w)}`);
  styles.push(`height: ${px(h)}`);
  
  // Background
  const bg = getBgColor(node);
  if (bg) styles.push(`background: ${bg}`);
  
  return styles.join(';\n  ');
}

function generateComponentCSS_All(): string {
  if (componentClasses.size === 0) return '';
  
  const cssRules: string[] = ['/* Component Classes */'];
  
  componentClasses.forEach(({ selector, styles }) => {
    cssRules.push(`${selector} {`);
    cssRules.push(`  ${styles};`);
    cssRules.push('}');
    cssRules.push('');
  });
  
  return cssRules.join('\n');
}

// ---------- Advanced Shape Support ----------

function isSimpleEllipse(node: SceneNode): boolean {
  if (node.type !== "ELLIPSE") return false;
  
  // Reject if has image fills
  if ("fills" in node && Array.isArray(node.fills)) {
    const hasImageFill = node.fills.some(f => f.type === "IMAGE");
    if (hasImageFill) return false;
  }
  
  // Reject if has complex gradients
  if ("fills" in node && Array.isArray(node.fills)) {
    const hasComplexGradient = node.fills.some(f => 
      f.type === "GRADIENT_RADIAL" || 
      f.type === "GRADIENT_DIAMOND" || 
      f.type === "GRADIENT_ANGULAR"
    );
    if (hasComplexGradient) return false;
  }
  
  // Reject if has unsupported effects
  if ("effects" in node && node.effects && node.effects.length > 0) {
    const hasUnsupportedEffects = node.effects.some(effect => 
      effect.type === "LAYER_BLUR" || 
      effect.type === "BACKGROUND_BLUR" ||
      effect.type === "INNER_SHADOW"
    );
    if (hasUnsupportedEffects) return false;
  }
  
  // Reject if transformed
  if (hasTransforms(node)) return false;
  
  return true;
}

function ellipseToCSS(node: SceneNode): string {
  const styles: string[] = [];
  
  // Size
  const { w, h } = sizeOf(node);
  if (w) styles.push(`width: ${px(w)}`);
  if (h) styles.push(`height: ${px(h)}`);
  
  // Make it circular/elliptical
  styles.push('border-radius: 50%');
  
  // Background
  const bg = getBgColor(node);
  if (bg) styles.push(`background: ${bg}`);
  
  // Linear gradient support (simple ones)
  if ("fills" in node && Array.isArray(node.fills)) {
    const gradientFill = node.fills.find(f => f.type === "GRADIENT_LINEAR") as GradientPaint | undefined;
    if (gradientFill && gradientFill.gradientStops) {
      const stops = gradientFill.gradientStops.map(stop => {
        const { r, g, b } = stop.color;
        const opacity = stop.color.a ?? 1;
        return `rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, ${opacity}) ${Math.round(stop.position * 100)}%`;
      }).join(', ');
      
      const transform = gradientFill.gradientTransform;
      let angle = 0;
      if (transform) {
        angle = Math.atan2(transform[0][1], transform[0][0]) * (180 / Math.PI);
      }
      
      styles.push(`background: linear-gradient(${Math.round(angle)}deg, ${stops})`);
    }
  }
  
  // Border
  if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.length > 0) {
    const stroke = node.strokes[0] as SolidPaint;
    if (stroke.type === "SOLID") {
      const strokeWidth = ("strokeWeight" in node && node.strokeWeight) ? node.strokeWeight : 1;
      const strokeColor = colorToCss(stroke);
      styles.push(`border: ${px(strokeWidth)} solid ${strokeColor}`);
    }
  }
  
  // Box shadow (drop shadow only)
  if ("effects" in node && node.effects && node.effects.length > 0) {
    const shadows = node.effects
      .filter(effect => effect.type === "DROP_SHADOW" && effect.visible !== false)
      .map(shadow => {
        const x = shadow.offset?.x || 0;
        const y = shadow.offset?.y || 0;
        const blur = shadow.radius || 0;
        const spread = shadow.spread || 0;
        const { r, g, b } = shadow.color;
        const opacity = shadow.color.a ?? 0.25;
        return `${px(x)} ${px(y)} ${px(blur)} ${px(spread)} rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, ${opacity})`;
      });
    
    if (shadows.length > 0) {
      styles.push(`box-shadow: ${shadows.join(', ')}`);
    }
  }
  
  // Opacity
  if ("opacity" in node && node.opacity !== undefined && node.opacity < 1) {
    styles.push(`opacity: ${node.opacity}`);
  }
  
  return styles.join('; ');
}

function ellipseToDivCSS(node: SceneNode, parentAbs?: Transform): string {
  const { x, y } = offsetWithinParent(node, parentAbs);
  const baseStyles = [`position: absolute`, `left: ${px(x)}`, `top: ${px(y)}`];
  const ellipseStyles = ellipseToCSS(node);
  
  return [...baseStyles, ellipseStyles].join('; ');
}

// ---------- Z-Index Management ----------

const zIndexMap = new Map<string, number>();
let currentZIndex = 1;

function calculateZIndex(node: SceneNode, siblings: SceneNode[]): number {
  // If already calculated, return cached value
  if (zIndexMap.has(node.id)) {
    return zIndexMap.get(node.id)!;
  }
  
  // Find position in siblings array (Figma layer order)
  const index = siblings.indexOf(node);
  const zIndex = currentZIndex + index;
  
  zIndexMap.set(node.id, zIndex);
  return zIndex;
}

function addZIndexIfNeeded(styles: string[], node: SceneNode, siblings: SceneNode[]): string[] {
  // Only add z-index if there are overlapping elements
  if (siblings.length > 1) {
    const zIndex = calculateZIndex(node, siblings);
    return [...styles, `z-index: ${zIndex}`];
  }
  return styles;
}

// ---------- Better Asset Optimization ----------

async function optimizeImageExport(node: SceneNode, format: "PNG" | "SVG" = "PNG"): Promise<{ bytes: Uint8Array, ext: string, optimized: boolean } | null> {
  try {
    if (!canAttemptExport(node)) return null;
    
    const { w, h } = sizeOf(node);
    
    // Use SVG for simple vector shapes
    if (format === "SVG" && ["VECTOR", "RECTANGLE", "ELLIPSE", "POLYGON", "STAR"].includes(node.type)) {
      const svgBytes = await (node as any).exportAsync({ format: "SVG" });
      if (svgBytes) {
        return { bytes: svgBytes, ext: "svg", optimized: true };
      }
    }
    
    // Use appropriate PNG settings based on size
    const settings: any = { format: "PNG" };
    
    // High DPI for small icons
    if (w <= 64 && h <= 64) {
      settings.constraint = { type: "SCALE", value: 2 };
    }
    // Normal DPI for large images
    else if (w > 512 || h > 512) {
      settings.constraint = { type: "SCALE", value: 1 };
    }
    
    const bytes = await (node as any).exportAsync(settings);
    return { bytes, ext: "png", optimized: true };
    
  } catch (e) {
    return null;
  }
}

function fontToGoogleFont(fontName: string): string | null {
  // Map Figma font names to Google Fonts
  const fontMap: Record<string, string> = {
    'Inter': 'Inter:wght@100;200;300;400;500;600;700;800;900',
    'Roboto': 'Roboto:wght@100;300;400;500;700;900',
    'Open Sans': 'Open+Sans:wght@300;400;500;600;700;800',
    'Poppins': 'Poppins:wght@100;200;300;400;500;600;700;800;900',
    'Montserrat': 'Montserrat:wght@100;200;300;400;500;600;700;800;900',
    'Nunito': 'Nunito:wght@200;300;400;500;600;700;800;900',
    'Lato': 'Lato:wght@100;300;400;700;900',
    'Source Sans Pro': 'Source+Sans+Pro:wght@200;300;400;600;700;900',
    'Raleway': 'Raleway:wght@100;200;300;400;500;600;700;800;900',
    'Playfair Display': 'Playfair+Display:wght@400;500;600;700;800;900',
    'Merriweather': 'Merriweather:wght@300;400;700;900',
    'Oswald': 'Oswald:wght@200;300;400;500;600;700',
    'PT Sans': 'PT+Sans:wght@400;700',
    'Ubuntu': 'Ubuntu:wght@300;400;500;700',
    'Noto Sans': 'Noto+Sans:wght@100;200;300;400;500;600;700;800;900'
  };
  
  return fontMap[fontName] || null;
}

function getFontFallback(fontName: string): string {
  const serifFonts = ['Times', 'Times New Roman', 'Georgia', 'Playfair Display', 'Merriweather'];
  const monoFonts = ['Monaco', 'Menlo', 'Consolas', 'Courier', 'monospace'];
  
  if (serifFonts.some(f => fontName.includes(f))) {
    return 'serif';
  }
  if (monoFonts.some(f => fontName.includes(f))) {
    return 'monospace';
  }
  return 'sans-serif';
}

function textNodeToCSS(node: TextNode): string {
  const styles: string[] = [];
  
  // Get text style (Figma supports mixed styles, but we'll use the first style as base)
  const textStyle = node.getRangeTextStyleId(0, 1);
  
  // Font family
  const fontName = node.fontName as FontName | { family: string; style: string };
  let familyName = '';
  if (typeof fontName === 'object' && 'family' in fontName) {
    familyName = fontName.family;
  } else {
    // Fallback for mixed fonts - use first character
    const firstCharFont = node.getRangeFontName(0, 1) as FontName;
    familyName = firstCharFont.family;
  }
  
  // Add to used fonts for Google Fonts loading
  const googleFont = fontToGoogleFont(familyName);
  if (googleFont) {
    usedFonts.add(googleFont);
    styles.push(`font-family: "${familyName}", ${getFontFallback(familyName)}`);
  } else {
    styles.push(`font-family: "${familyName}", ${getFontFallback(familyName)}`);
  }
  
  // Font size
  const fontSize = node.fontSize as number | symbol;
  if (typeof fontSize === 'number') {
    styles.push(`font-size: ${Math.round(fontSize)}px`);
  } else {
    // Mixed font sizes - use first character
    const firstCharSize = node.getRangeFontSize(0, 1) as number;
    styles.push(`font-size: ${Math.round(firstCharSize)}px`);
  }
  
  // Font weight
  const fontWeight = node.fontWeight as number | symbol;
  if (typeof fontWeight === 'number') {
    styles.push(`font-weight: ${fontWeight}`);
  } else {
    // Mixed weights - use first character
    const firstCharWeight = node.getRangeFontWeight(0, 1) as number;
    styles.push(`font-weight: ${firstCharWeight}`);
  }
  
  // Text color
  const fills = node.fills as Paint[];
  if (fills && fills.length > 0) {
    const textFill = fills.find(f => f.type === "SOLID") as SolidPaint;
    if (textFill) {
      const color = colorToCss(textFill);
      styles.push(`color: ${color}`);
    }
  }
  
  // Line height
  const lineHeight = node.lineHeight;
  if (lineHeight && typeof lineHeight === 'object' && lineHeight.unit) {
    if (lineHeight.unit === 'PIXELS') {
      styles.push(`line-height: ${Math.round(lineHeight.value)}px`);
    } else if (lineHeight.unit === 'PERCENT') {
      styles.push(`line-height: ${(lineHeight.value / 100).toFixed(2)}`);
    }
  } else if (typeof lineHeight === 'number') {
    styles.push(`line-height: ${lineHeight.toFixed(2)}`);
  }
  
  // Letter spacing
  const letterSpacing = node.letterSpacing;
  if (letterSpacing && typeof letterSpacing === 'object' && letterSpacing.unit) {
    if (letterSpacing.unit === 'PIXELS') {
      styles.push(`letter-spacing: ${letterSpacing.value.toFixed(2)}px`);
    } else if (letterSpacing.unit === 'PERCENT') {
      styles.push(`letter-spacing: ${(letterSpacing.value / 100).toFixed(3)}em`);
    }
  }
  
  // Text align
  const textAlign = node.textAlignHorizontal;
  if (textAlign && textAlign !== 'LEFT') {
    styles.push(`text-align: ${textAlign.toLowerCase()}`);
  }
  
  // Text decoration
  const textDecoration = node.textDecoration;
  if (textDecoration && textDecoration !== 'NONE') {
    styles.push(`text-decoration: ${textDecoration.toLowerCase()}`);
  }
  
  // Text transform
  const textCase = node.textCase;
  if (textCase && textCase !== 'ORIGINAL') {
    const caseMap: Record<string, string> = {
      'UPPER': 'uppercase',
      'LOWER': 'lowercase',
      'TITLE': 'capitalize'
    };
    if (caseMap[textCase]) {
      styles.push(`text-transform: ${caseMap[textCase]}`);
    }
  }
  
  return styles.join('; ');
}

function renderMixedTextContent(node: TextNode): string {
  const text = node.characters;
  const length = text.length;
  
  if (length === 0) return '';
  
  // Check if text has mixed styling
  let hasMixedStyling = false;
  const firstFont = node.getRangeFontName(0, 1) as FontName;
  const firstSize = node.getRangeFontSize(0, 1) as number;
  const firstWeight = node.getRangeFontWeight(0, 1) as number;
  
  for (let i = 1; i < length; i++) {
    const font = node.getRangeFontName(i, i + 1) as FontName;
    const size = node.getRangeFontSize(i, i + 1) as number;
    const weight = node.getRangeFontWeight(i, i + 1) as number;
    
    if (font.family !== firstFont.family || 
        font.style !== firstFont.style ||
        size !== firstSize ||
        weight !== firstWeight) {
      hasMixedStyling = true;
      break;
    }
  }
  
  // If no mixed styling, return simple text
  if (!hasMixedStyling) {
    return escapeHtml(text);
  }
  
  // Handle mixed styling with spans
  const segments: Array<{text: string, styles: string}> = [];
  let currentStart = 0;
  
  for (let i = 1; i <= length; i++) {
    const needsSplit = i === length || (() => {
      const currentFont = node.getRangeFontName(i - 1, i) as FontName;
      const nextFont = node.getRangeFontName(i, i + 1) as FontName;
      const currentSize = node.getRangeFontSize(i - 1, i) as number;
      const nextSize = node.getRangeFontSize(i, i + 1) as number;
      const currentWeight = node.getRangeFontWeight(i - 1, i) as number;
      const nextWeight = node.getRangeFontWeight(i, i + 1) as number;
      
      return currentFont.family !== nextFont.family || 
             currentFont.style !== nextFont.style ||
             currentSize !== nextSize ||
             currentWeight !== nextWeight;
    })();
    
    if (needsSplit) {
      const segmentText = text.slice(currentStart, i);
      const font = node.getRangeFontName(currentStart, currentStart + 1) as FontName;
      const size = node.getRangeFontSize(currentStart, currentStart + 1) as number;
      const weight = node.getRangeFontWeight(currentStart, currentStart + 1) as number;
      
      const segmentStyles: string[] = [];
      
      // Font family
      const googleFont = fontToGoogleFont(font.family);
      if (googleFont) {
        usedFonts.add(googleFont);
      }
      segmentStyles.push(`font-family: "${font.family}", ${getFontFallback(font.family)}`);
      
      // Font size
      segmentStyles.push(`font-size: ${Math.round(size)}px`);
      
      // Font weight
      segmentStyles.push(`font-weight: ${weight}`);
      
      segments.push({
        text: segmentText,
        styles: segmentStyles.join('; ')
      });
      
      currentStart = i;
    }
  }
  
  return segments.map(segment => 
    `<span style="${segment.styles}">${escapeHtml(segment.text)}</span>`
  ).join('');
}

function generateFontImports(): string {
  if (usedFonts.size === 0) return '';
  
  const fontUrls = Array.from(usedFonts).map(font => 
    `https://fonts.googleapis.com/css2?family=${font}&display=swap`
  );
  
  return fontUrls.map(url => 
    `<link href="${url}" rel="stylesheet">`
  ).join('\n    ');
}

function hasChildren(n: SceneNode): n is (FrameNode | GroupNode | ComponentNode | InstanceNode) {
  return ("children" in n) && Array.isArray((n as any).children);
}

function sizeOf(node: SceneNode) {
  const w = (node as LayoutMixin).width ?? 0;
  const h = (node as LayoutMixin).height ?? 0;
  return { w, h };
}

function offsetWithinParent(node: SceneNode, parentAbs?: Transform) {
  if (!parentAbs) return { x: 0, y: 0 }; // root container handles its own origin
  const a = node.absoluteTransform;
  const x = a[0][2] - parentAbs[0][2];
  const y = a[1][2] - parentAbs[1][2];
  return { x, y };
}

function detectImageExt(bytes: Uint8Array): "png"|"jpg"|"jpeg"|"webp"|"gif"|"unknown" {
  if (bytes.length >= 8 && bytes[0]===0x89 && bytes[1]===0x50 && bytes[2]===0x4E && bytes[3]===0x47) return "png";
  if (bytes.length >= 3 && bytes[0]===0xFF && bytes[1]===0xD8 && bytes[2]===0xFF) return "jpg";
  if (bytes.length >= 12 && bytes[8]===0x57 && bytes[9]===0x45 && bytes[10]===0x42 && bytes[11]===0x50) return "webp";
  if (bytes.length >= 6 && bytes[0]===0x47 && bytes[1]===0x49 && bytes[2]===0x46) return "gif";
  return "unknown";
}

function canAttemptExport(node: SceneNode): boolean {
  if (!("visible" in node) || !node.visible) return false;
  if ("opacity" in node && node.opacity === 0) return false;
  const { w, h } = sizeOf(node);
  if (w === 0 || h === 0) return false;
  return true;
}

async function tryExportNodeImage(node: SceneNode, fmt: "PNG"|"SVG"="PNG"): Promise<Uint8Array|null> {
  try {
    if (!canAttemptExport(node)) return null;
    return await (node as any).exportAsync({ format: fmt });
  } catch (e) {
    return null;
  }
}

async function exportFillImage(node: SceneNode, fill: ImagePaint): Promise<{ bytes: Uint8Array, ext: string } | null> {
  try {
    if (!fill?.imageHash) return null;
    
    // PERBAIKAN: Untuk image fills, SELALU export node sebagai PNG
    // karena Figma image fills hampir pasti punya konfigurasi crop/scale/transform
    // yang tidak bisa didapat dari getBytesAsync() - itu hanya image mentah
    
    figma.ui.postMessage({ 
      type: "log", 
      text: `📸 Exporting image fill for "${node.name}" - always use node export for proper crop/scale` 
    });
    
    const editedBytes = await tryExportNodeImage(node, "PNG");
    if (editedBytes) {
      return { bytes: editedBytes, ext: "png" };
    }
    
    // Fallback ke image asli HANYA jika node export gagal
    // (tapi ini jarang terjadi dan hasilnya mungkin tidak sesuai)
    figma.ui.postMessage({ 
      type: "log", 
      text: `⚠️ Node export failed for "${node.name}", falling back to raw image (may not match design)` 
    });
    
    const img = figma.getImageByHash(fill.imageHash);
    const bytes = await img.getBytesAsync();
    const ext = detectImageExt(bytes);
    return { bytes, ext: ext === "unknown" ? "png" : ext };
  } catch (e) {
    figma.ui.postMessage({ 
      type: "log", 
      text: `❌ Failed to export image for "${node.name}": ${e}` 
    });
    return null;
  }
}

// ---------- Logo/Group Detection ----------
function hasTransforms(node: SceneNode): boolean {
  if (!("absoluteTransform" in node)) return false;
  const transform = node.absoluteTransform;
  
  // Cek apakah ada rotation (matrix bukan identity untuk rotation)
  const a = transform[0][0]; // scaleX/cosθ
  const b = transform[0][1]; // skewY/sinθ  
  const c = transform[1][0]; // skewX/-sinθ
  const d = transform[1][1]; // scaleY/cosθ
  
  // Jika ada rotation, b dan c tidak akan 0
  const hasRotation = Math.abs(b) > 0.001 || Math.abs(c) > 0.001;
  
  // Cek scaling yang tidak normal (bukan 1)
  const hasScaling = Math.abs(a - 1) > 0.001 || Math.abs(d - 1) > 0.001;
  
  return hasRotation || hasScaling;
}

function hasImageFills(node: SceneNode): boolean {
  // Cek apakah node atau children-nya punya image fills
  if ("fills" in node && Array.isArray(node.fills)) {
    const hasImgFill = node.fills.some(f => f.type === "IMAGE");
    if (hasImgFill) return true;
  }
  
  // Cek children recursively
  if (hasChildren(node)) {
    return (node as any).children.some((child: SceneNode) => hasImageFills(child));
  }
  
  return false;
}

function isMergedShape(node: SceneNode): boolean {
  // Boolean operations selalu di-export sebagai image
  if (node.type === "BOOLEAN_OPERATION") return true;
  
  // Rectangle yang di-merge dengan shapes lain
  if (node.type === "RECTANGLE" && hasChildren(node)) {
    const hasVectorChildren = (node as any).children?.some((child: SceneNode) => 
      ["VECTOR", "RECTANGLE", "ELLIPSE", "POLYGON", "STAR"].includes(child.type)
    );
    return hasVectorChildren;
  }
  
  // Jika parent adalah boolean operation
  return false; // Ini akan dicek di level parent
}

// NEW: Convert Figma transforms to CSS transform
function transformToCSS(node: SceneNode): string {
  if (!("absoluteTransform" in node)) return "";
  
  const transform = node.absoluteTransform;
  const transforms: string[] = [];
  
  // Extract rotation and scale from matrix
  const a = transform[0][0]; // scaleX/cosθ
  const b = transform[0][1]; // skewY/sinθ  
  const c = transform[1][0]; // skewX/-sinθ
  const d = transform[1][1]; // scaleY/cosθ
  
  // Calculate rotation angle
  const rotation = Math.atan2(b, a) * (180 / Math.PI);
  if (Math.abs(rotation) > 0.1) {
    transforms.push(`rotate(${rotation.toFixed(2)}deg)`);
  }
  
  // Calculate scale (compensate for rotation)
  const scaleX = Math.sqrt(a * a + b * b);
  const scaleY = Math.sqrt(c * c + d * d);
  
  if (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001) {
    if (Math.abs(scaleX - scaleY) < 0.001) {
      // Uniform scale
      transforms.push(`scale(${scaleX.toFixed(3)})`);
    } else {
      // Non-uniform scale
      transforms.push(`scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`);
    }
  }
  
  return transforms.length > 0 ? transforms.join(" ") : "";
}

// NEW: Convert Figma effects to CSS filters and box-shadows
function effectsToCSS(node: SceneNode): { filter: string; boxShadow: string; backdropFilter: string } {
  const filters: string[] = [];
  const shadows: string[] = [];
  const backdropFilters: string[] = [];
  
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
        const x = effect.offset?.x || 0;
        const y = effect.offset?.y || 0;
        const blur = effect.radius || 0;
        const spread = effect.spread || 0;
        const { r, g, b } = effect.color;
        const opacity = effect.color.a ?? 0.25;
        shadows.push(`${px(x)} ${px(y)} ${px(blur)} ${px(spread)} rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, ${opacity})`);
        break;
        
      case "INNER_SHADOW":
        const ix = effect.offset?.x || 0;
        const iy = effect.offset?.y || 0;
        const iblur = effect.radius || 0;
        const ispread = effect.spread || 0;
        const { r: ir, g: ig, b: ib } = effect.color;
        const iopacity = effect.color.a ?? 0.25;
        shadows.push(`inset ${px(ix)} ${px(iy)} ${px(iblur)} ${px(ispread)} rgba(${Math.round(ir*255)}, ${Math.round(ig*255)}, ${Math.round(ib*255)}, ${iopacity})`);
        break;
    }
  }
  
  return {
    filter: filters.length > 0 ? filters.join(" ") : "",
    boxShadow: shadows.length > 0 ? shadows.join(", ") : "",
    backdropFilter: backdropFilters.length > 0 ? backdropFilters.join(" ") : ""
  };
}

// UPDATED: More permissive rectangle detection
function isSimpleRectangle(node: SceneNode): boolean {
  if (node.type !== "RECTANGLE") return false;
  
  // Jika merged dengan shapes lain, tidak bisa jadi div
  if (isMergedShape(node)) return false;
  
  // Jika ada image fill, tidak bisa jadi div (tetap perlu export sebagai gambar)
  if ("fills" in node && Array.isArray(node.fills)) {
    const hasImageFill = node.fills.some(f => f.type === "IMAGE");
    if (hasImageFill) return false;
  }
  
  // REMOVED: Transform restrictions - sekarang transforms akan dikonversi ke CSS
  // REMOVED: Blur effect restrictions - sekarang blur akan dikonversi ke CSS filter
  
  return true;
}

// UPDATED: Enhanced CSS generation with transforms and effects
function rectangleToCSS(node: SceneNode): string {
  const styles: string[] = [];
  
  // Size
  const { w, h } = sizeOf(node);
  if (w) styles.push(`width:${px(w)}`);
  if (h) styles.push(`height:${px(h)}`);
  
  // Background
  const bg = getBgColor(node);
  if (bg) styles.push(`background:${bg}`);
  
  // Linear gradient support
  if ("fills" in node && Array.isArray(node.fills)) {
    const gradientFill = node.fills.find(f => f.type === "GRADIENT_LINEAR") as GradientPaint | undefined;
    if (gradientFill && gradientFill.gradientStops) {
      const stops = gradientFill.gradientStops.map(stop => {
        const { r, g, b } = stop.color;
        const opacity = stop.color.a ?? 1;
        return `rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, ${opacity}) ${Math.round(stop.position * 100)}%`;
      }).join(', ');
      
      // Calculate angle from gradient transform
      const transform = gradientFill.gradientTransform;
      let angle = 0;
      if (transform) {
        angle = Math.atan2(transform[0][1], transform[0][0]) * (180 / Math.PI);
      }
      
      styles.push(`background:linear-gradient(${Math.round(angle)}deg, ${stops})`);
    }
  }
  
  // Border radius
  if ("cornerRadius" in node && node.cornerRadius) {
    if (typeof node.cornerRadius === "number") {
      styles.push(`border-radius:${px(node.cornerRadius)}`);
    } else if (Array.isArray(node.cornerRadius)) {
      const [tl, tr, br, bl] = node.cornerRadius;
      styles.push(`border-radius:${px(tl)} ${px(tr)} ${px(br)} ${px(bl)}`);
    }
  }
  
  // Stroke/Border
  if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.length > 0) {
    const stroke = node.strokes[0] as SolidPaint;
    if (stroke.type === "SOLID") {
      const strokeWidth = ("strokeWeight" in node && node.strokeWeight) ? node.strokeWeight : 1;
      const strokeColor = colorToCss(stroke);
      styles.push(`border:${px(strokeWidth)} solid ${strokeColor}`);
    }
  }
  
  // NEW: Transform support
  const transformCSS = transformToCSS(node);
  if (transformCSS) {
    styles.push(`transform:${transformCSS}`);
    // Add transform-origin for better rotation behavior
    styles.push(`transform-origin:center center`);
  }
  
  // NEW: Effects support (blur, shadows, etc)
  const { filter, boxShadow, backdropFilter } = effectsToCSS(node);
  if (filter) styles.push(`filter:${filter}`);
  if (boxShadow) styles.push(`box-shadow:${boxShadow}`);
  if (backdropFilter) styles.push(`backdrop-filter:${backdropFilter}`);
  
  // Opacity
  if ("opacity" in node && node.opacity !== undefined && node.opacity < 1) {
    styles.push(`opacity:${node.opacity}`);
  }
  
  return styles.join('; ');
}

function rectangleToDivCSS(node: SceneNode, parentAbs?: Transform): string {
  const { x, y } = offsetWithinParent(node, parentAbs);
  const baseStyles = [`position:absolute`, `left:${px(x)}`, `top:${px(y)}`];
  const rectStyles = rectangleToCSS(node);
  
  return [...baseStyles, rectStyles].join('; ');
}

function hasComplexEffects(node: SceneNode): boolean {
  // UPDATED: Since we now support all effects as CSS, remove effect-based restrictions
  // Keep only opacity check for very transparent elements
  if ("opacity" in node && node.opacity !== undefined && node.opacity < 0.05) {
    return true;
  }
  
  // Cek children
  if (hasChildren(node)) {
    return (node as any).children.some((child: SceneNode) => hasComplexEffects(child));
  }
  
  return false;
}

function detectGroupType(node: SceneNode): "logo" | "component" | "layout" | "simple" {
  if (!hasChildren(node)) return "simple";
  
  const children = (node as any).children;
  const name = node.name?.toLowerCase() || "";
  
  // Cek logo indicators
  const logoKeywords = ["logo", "brand", "icon", "symbol", "mark"];
  const hasLogoName = logoKeywords.some(keyword => name.includes(keyword));
  
  // Cek transforms
  const hasComplexTransforms = hasTransforms(node);
  
  // Cek tipe children
  const shapeTypes = ["VECTOR", "BOOLEAN_OPERATION", "RECTANGLE", "ELLIPSE", "POLYGON", "STAR"];
  const shapeCount = children.filter((child: SceneNode) => shapeTypes.includes(child.type)).length;
  const textCount = children.filter((child: SceneNode) => child.type === "TEXT").length;
  
  // Auto layout = layout component
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    return "layout";
  }
  
  // Logo detection
  if (hasLogoName || hasComplexTransforms) return "logo";
  if (shapeCount >= 2 && children.length <= 5) return "logo"; // Small group of shapes
  if (shapeCount > 0 && textCount > 0 && children.length <= 4) return "logo"; // Icon + text
  
  // Component detection  
  if (children.length > 1 && children.length <= 8) return "component";
  
  return "simple";
}

type LayerInfo = {
  id: string;
  name: string;
  type: string;
  groupType: "logo" | "component" | "layout" | "simple";
  shouldExportWhole: boolean;
  path: string;
  node: SceneNode;
  children?: LayerInfo[];
};

function analyzeLayer(node: SceneNode, path: string = ""): LayerInfo {
  const currentPath = path ? `${path} > ${node.name}` : node.name;
  const groupType = detectGroupType(node);
  
  const info: LayerInfo = {
    id: node.id,
    name: node.name || node.type,
    type: node.type,
    groupType,
    shouldExportWhole: groupType === "logo", // Default: logo = export whole
    path: currentPath,
    node,
  };
  
  // Analyze children
  if (hasChildren(node)) {
    info.children = (node as any).children
      .filter((child: SceneNode) => child.visible)
      .map((child: SceneNode) => analyzeLayer(child, currentPath));
  }
  
  return info;
}

// Track nama unik per folder
const usedNamesPerFolder = new Map<string, Record<string, number>>();
function uniqueName(folder: string, base: string, ext: string) {
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

// ---------- HTML rendering (Hybrid) ----------
function twForAutoLayout(node: AutoLayoutMixin & SceneNode) {
  const classes: string[] = ["flex", node.layoutMode === "VERTICAL" ? "flex-col" : "flex-row"];
  const gap = node.itemSpacing ?? 0;
  if (gap) classes.push(node.layoutMode === "VERTICAL" ? `gap-y-[${Math.round(gap)}px]` : `gap-x-[${Math.round(gap)}px]`);
  const pT = node.paddingTop ?? 0, pR = node.paddingRight ?? 0, pB = node.paddingBottom ?? 0, pL = node.paddingLeft ?? 0;
  if (pT || pR || pB || pL) {
    classes.push(`pt-[${Math.round(pT)}px]`, `pr-[${Math.round(pR)}px]`, `pb-[${Math.round(pB)}px]`, `pl-[${Math.round(pL)}px]`);
  }
  // alignment (basic)
  if (node.primaryAxisAlignItems === "CENTER") classes.push("justify-center");
  if (node.primaryAxisAlignItems === "MAX") classes.push("justify-end");
  if (node.counterAxisAlignItems === "CENTER") classes.push("items-center");
  if (node.counterAxisAlignItems === "MAX") classes.push("items-end");
  return classes;
}

function styleSize(node: SceneNode) {
  const { w, h } = sizeOf(node);
  const parts = [];
  if (w) parts.push(`width:${px(w)}`);
  if (h) parts.push(`height:${px(h)}`);
  return parts.join("; ");
}

function styleAbsoluteBox(node: SceneNode, parentAbs?: Transform) {
  const { x, y } = offsetWithinParent(node, parentAbs);
  const { w, h } = sizeOf(node);
  const parts = [`position:absolute`, `left:${px(x)}`, `top:${px(y)}`, `width:${px(w)}`, `height:${px(h)}`];
  const bg = getBgColor(node); if (bg) parts.push(`background:${bg}`);
  return parts.join("; ");
}

// ---------- Traversal & asset collection ----------
type AssetOut = { path: string, data: string }; // base64

// Map untuk menyimpan layer preferences
let layerPreferences = new Map<string, boolean>();

// FIXED: Correct visual ordering function
function sortChildrenByVisualOrder(children: SceneNode[], parentTransform?: Transform): SceneNode[] {
  return children.slice().sort((a, b) => {
    // Get absolute Y positions
    let aY = a.absoluteTransform[1][2]; // Y coordinate
    let bY = b.absoluteTransform[1][2];
    
    // IMPORTANT: Don't subtract parent transform if we're using absolute positions
    // The absoluteTransform already gives us the final screen position
    
    figma.ui.postMessage({ 
      type: "log", 
      text: `🔄 Sorting: "${a.name}" (Y:${Math.round(aY)}) vs "${b.name}" (Y:${Math.round(bY)})` 
    });
    
    // Sort by Y position (top to bottom) - SMALLER Y values come first
    if (Math.abs(aY - bY) > 10) { // 10px threshold untuk handle floating point errors
      return aY - bY; // Top elements first (smaller Y values)
    }
    
    // If roughly same Y, sort by X position (left to right)
    let aX = a.absoluteTransform[0][2];
    let bX = b.absoluteTransform[0][2];
    
    return aX - bX; // Left elements first (smaller X values)
  });
}