#!/bin/bash

# Script to fix the getIsMyContact error in whatsapp-web.js
# This script patches the Utils.js file to add fallback for missing ContactMethods

UTILS_PATH="node_modules/whatsapp-web.js/src/util/Injected/Utils.js"

if [ ! -f "$UTILS_PATH" ]; then
    echo "❌ Error: Utils.js file not found at: $UTILS_PATH"
    echo "   Make sure you have installed whatsapp-web.js package"
    exit 1
fi

echo "📝 Reading Utils.js file..."

# Check if already patched
if grep -q "safeGet" "$UTILS_PATH"; then
    echo "✅ File already patched!"
    exit 0
fi

echo "🔧 Applying patch..."

# Create backup
cp "$UTILS_PATH" "${UTILS_PATH}.backup"
echo "💾 Backup created: ${UTILS_PATH}.backup"

# Use sed to replace the problematic section
# This is a simplified approach - for more complex replacements, use the Node.js script
sed -i 's/res\.isMyContact = window\.Store\.ContactMethods\.getIsMyContact(contact);/res.isMyContact = (window.Store.ContactMethods \&\& typeof window.Store.ContactMethods.getIsMyContact === '\''function'\'') ? window.Store.ContactMethods.getIsMyContact(contact) : (contact.isMyContact !== undefined ? contact.isMyContact : false);/g' "$UTILS_PATH"

if [ $? -eq 0 ]; then
    echo "✅ Patch applied successfully!"
    echo "🔄 Please restart your application: pm2 restart whatsapp-dashboard"
else
    echo "❌ Error: Failed to apply patch"
    echo "   Restoring backup..."
    mv "${UTILS_PATH}.backup" "$UTILS_PATH"
    exit 1
fi

