# Figma to HTML/Tailwind Converter

A powerful Figma plugin that converts your designs to clean, semantic HTML with Tailwind CSS support while preserving the visual hierarchy and structure of your design.

## ✨ Features

- **Accurate Layout Conversion**: Converts Figma frames, groups, and components to semantic HTML
- **Responsive Design**: Maintains proper element positioning and sizing
- **Tailwind CSS Ready**: Generates HTML with Tailwind CSS classes
- **Asset Export**: Automatically exports and links all images and icons
- **Text Styling**: Preserves font styles, weights, and text formatting
- **Layer Organization**: Maintains layer hierarchy and z-index ordering
- **Visual Debugging**: Includes debug information for troubleshooting

## 🚀 Installation

1. Download the latest release of the plugin
2. In Figma, go to `Menu > Plugins > Development > Import plugin from manifest...`
3. Select the `manifest.json` file from the downloaded package
4. The plugin will be installed and available in your Figma plugins menu

## 🛠️ Usage

1. Select one or more frames/components in your Figma file
2. Run the plugin from the Figma plugins menu: `Plugins > Figma to HTML (Hierarki) > Export HTML + Assets`
3. In the plugin UI:
   - Review the layer hierarchy
   - Toggle individual layer export settings
   - Click "Export" to generate the HTML
4. The plugin will create a ZIP file containing:
   - `index.html` - The main HTML file
   - `assets/` - Folder containing all exported images and icons
   - `screenshot.png` - A full screenshot of the exported design

## 🎨 Supported Elements

- Frames and groups
- Text elements with proper styling
- Vector shapes (rectangles, ellipses, polygons, stars, lines)
- Images (fills and image components)
- Auto-layout frames (converted to flex containers)
- Basic effects (shadows, blurs, opacity)
- Nested components and instances

## 🧩 Advanced Features

### Layer Control
- Toggle between exporting individual elements or groups as images
- Control which layers get exported as images vs. HTML

### Design Tokens
- Extracts colors, fonts, spacing, and other design tokens
- Generates CSS variables for consistent theming

### Google Fonts
- Automatically detects and includes required Google Fonts
- Falls back to system fonts when needed

## 🧪 Development

### Building the Plugin

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the plugin:
   ```bash
   npm run build
   ```
4. The built files will be in the `dist/` directory

### File Structure

- `code.ts` - Main plugin logic
- `ui.html` - Plugin interface
- `manifest.json` - Plugin configuration
- `README.md` - This documentation

## 📝 Notes

- Complex vector shapes with gradients or effects may be exported as images
- Some advanced Figma features may have limited support
- For best results, organize your Figma layers with clear naming
- Use auto-layout for responsive components when possible

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
