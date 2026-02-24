#!/usr/bin/env node

/**
 * Script to fix the getIsMyContact error in whatsapp-web.js
 * This script patches the Utils.js file to add fallback for missing ContactMethods
 */

const fs = require('fs');
const path = require('path');

const utilsPath = path.join(__dirname, 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');

if (!fs.existsSync(utilsPath)) {
    console.error('❌ Error: Utils.js file not found at:', utilsPath);
    console.error('   Make sure you have installed whatsapp-web.js package');
    process.exit(1);
}

console.log('📝 Reading Utils.js file...');
let content = fs.readFileSync(utilsPath, 'utf8');

// Check if already patched
if (content.includes('safeGet')) {
    console.log('✅ File already patched!');
    process.exit(0);
}

console.log('🔧 Applying patch...');

// Find the getContactModel function
const oldPattern = /window\.WWebJS\.getContactModel\s*=\s*contact\s*=>\s*\{[\s\S]*?res\.isMyContact\s*=\s*window\.Store\.ContactMethods\.getIsMyContact\(contact\);/;

if (!oldPattern.test(content)) {
    console.error('❌ Error: Could not find the pattern to patch');
    console.error('   The file structure might be different');
    process.exit(1);
}

// Replacement pattern
const replacement = `window.WWebJS.getContactModel = contact => {
        let res = contact.serialize();
        res.isBusiness = contact.isBusiness === undefined ? false : contact.isBusiness;

        if (contact.businessProfile) {
            res.businessProfile = contact.businessProfile.serialize();
        }

        // Helper function to safely get ContactMethods values with fallback
        const safeGet = (methodName, fallback) => {
            try {
                if (window.Store.ContactMethods && typeof window.Store.ContactMethods[methodName] === 'function') {
                    return window.Store.ContactMethods[methodName](contact);
                }
            } catch (e) {
                // Method doesn't exist, use fallback
            }
            return fallback !== undefined ? fallback : false;
        };

        res.isMe = safeGet('getIsMe', contact.isMe);
        res.isUser = safeGet('getIsUser', contact.isUser);
        res.isGroup = safeGet('getIsGroup', contact.isGroup);
        res.isWAContact = safeGet('getIsWAContact', contact.isWAContact);
        res.isMyContact = safeGet('getIsMyContact', contact.isMyContact);
        res.isBlocked = contact.isContactBlocked;
        res.userid = safeGet('getUserid', contact.userid);
        res.isEnterprise = safeGet('getIsEnterprise', contact.isEnterprise);
        res.verifiedName = safeGet('getVerifiedName', contact.verifiedName);
        res.verifiedLevel = safeGet('getVerifiedLevel', contact.verifiedLevel);
        res.statusMute = safeGet('getStatusMute', contact.statusMute);
        res.name = safeGet('getName', contact.name);
        res.shortName = safeGet('getShortName', contact.shortName);
        res.pushname = safeGet('getPushname', contact.pushname);

        return res;
    };`;

// More precise replacement
const getContactModelRegex = /(window\.WWebJS\.getContactModel\s*=\s*contact\s*=>\s*\{[\s\S]*?)(res\.isMe\s*=\s*window\.Store\.ContactMethods\.getIsMe\(contact\);[\s\S]*?res\.isMyContact\s*=\s*window\.Store\.ContactMethods\.getIsMyContact\(contact\);[\s\S]*?res\.pushname\s*=\s*window\.Store\.ContactMethods\.getPushname\(contact\);[\s\S]*?return res;[\s\S]*?\};)/;

if (getContactModelRegex.test(content)) {
    content = content.replace(getContactModelRegex, replacement);
    fs.writeFileSync(utilsPath, content, 'utf8');
    console.log('✅ Patch applied successfully!');
    console.log('🔄 Please restart your application (pm2 restart whatsapp-dashboard)');
} else {
    console.error('❌ Error: Could not find the exact pattern to replace');
    console.error('   Trying alternative method...');
    
    // Alternative: replace just the problematic line
    const lineRegex = /res\.isMyContact\s*=\s*window\.Store\.ContactMethods\.getIsMyContact\(contact\);/;
    if (lineRegex.test(content)) {
        // Find the function and replace the whole section
        const functionStart = content.indexOf('window.WWebJS.getContactModel = contact => {');
        if (functionStart !== -1) {
            const functionEnd = content.indexOf('return res;', functionStart);
            if (functionEnd !== -1) {
                const beforeFunction = content.substring(0, functionStart);
                const afterFunction = content.substring(functionEnd + 'return res;'.length);
                const newFunction = replacement;
                content = beforeFunction + newFunction + afterFunction;
                fs.writeFileSync(utilsPath, content, 'utf8');
                console.log('✅ Patch applied successfully (alternative method)!');
                console.log('🔄 Please restart your application (pm2 restart whatsapp-dashboard)');
            } else {
                console.error('❌ Error: Could not find function end');
                process.exit(1);
            }
        } else {
            console.error('❌ Error: Could not find function start');
            process.exit(1);
        }
    } else {
        console.error('❌ Error: Could not find the line to patch');
        process.exit(1);
    }
}

