#!/bin/bash
# download_libs.sh
# Run this once to download the required libraries into the extension folder.
# Requires curl or wget.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "📦 Downloading html2canvas v1.4.1..."
curl -L "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" \
     -o "$SCRIPT_DIR/html2canvas.min.js"
echo "✅ html2canvas downloaded ($(wc -c < "$SCRIPT_DIR/html2canvas.min.js") bytes)"

echo "📦 Downloading jsPDF v2.5.1..."
curl -L "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" \
     -o "$SCRIPT_DIR/jspdf.umd.min.js"
echo "✅ jsPDF downloaded ($(wc -c < "$SCRIPT_DIR/jspdf.umd.min.js") bytes)"

echo ""
echo "🎉 All libraries ready! You can now load the extension in Chrome."
