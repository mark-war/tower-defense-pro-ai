# ANDROID

# Install Java JDK first (required by Android tooling)

# Download from adoptium.net

# Install Bubblewrap

npm install -g @bubblewrap/cli

# Initialize — point at your manifest URL

bubblewrap init --manifest https://your-game.vercel.app/manifest.json

# It asks you a few questions:

# - Package name: com.yourname.towerdefense

# - App name: Tower Defense Siege

# - It downloads Android SDK automatically

# Build the APK

bubblewrap build

##################################################################################################

# APPLE

## Vercel Deploy

npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init
npm run build
npx cap add ios
npx cap sync
npx cap open ios # opens Xcode, build from there

##################################################################################################

# On your Android device:

Settings → Security → Enable "Install unknown apps" or "Unknown sources"

# Transfer the APK to your phone (email, Google Drive, USB)

# Tap it → Install → done
