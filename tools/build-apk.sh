#!/usr/bin/env bash
# Empacota o app web em um APK Android com Capacitor (roda no GitHub Actions).
set -euo pipefail
ROOT="$(pwd)"; B="$ROOT/_apk"; rm -rf "$B"; mkdir -p "$B/www"
# 1) arquivos do app + MapLibre embutido (funciona sem baixar a biblioteca)
cp index.html style.css app.js extras.js sync.js offline.js nav.js config.js manifest.json icon.svg logo.svg "$B/www/"
curl -fsSL https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js -o "$B/www/maplibre-gl.js"
curl -fsSL https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css -o "$B/www/maplibre-gl.css"
sed -i 's#https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js#maplibre-gl.js#; s#https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css#maplibre-gl.css#' "$B/www/index.html"
cd "$B"
cat > package.json <<'J'
{"name":"pe-na-estrada","version":"1.0.0","private":true}
J
cat > capacitor.config.json <<'J'
{"appId":"br.com.penaestrada","appName":"Pé na Estrada","webDir":"www","server":{"androidScheme":"https"},"android":{"allowMixedContent":false}}
J
npm i --no-audit --no-fund @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6 @capacitor/assets@3 sharp
# 2) ícone
mkdir -p assets && node -e "require('sharp')('$ROOT/icon.svg',{density:400}).resize(1024,1024).flatten({background:'#fff1c9'}).png().toFile('assets/icon-only.png')"
cp assets/icon-only.png assets/icon-foreground.png
node -e "require('sharp')({create:{width:1024,height:1024,channels:3,background:'#fff1c9'}}).png().toFile('assets/icon-background.png')"
npx cap add android
npx capacitor-assets generate --android || echo "icones padrao"
# 3) permissões (GPS, câmera, internet, notificações)
node -e "
const fs=require('fs'),f='android/app/src/main/AndroidManifest.xml';let m=fs.readFileSync(f,'utf8');
const p=['ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION','CAMERA','POST_NOTIFICATIONS','WAKE_LOCK','VIBRATE','ACCESS_NETWORK_STATE'].filter(x=>!m.includes(x)).map(x=>'    <uses-permission android:name=\"android.permission.'+x+'\" />').join('\n');
m=m.replace('</manifest>',p+'\n    <uses-feature android:name=\"android.hardware.location.gps\" android:required=\"false\" />\n</manifest>');
fs.writeFileSync(f,m);"
npx cap sync android
# 4) compila
cd android && chmod +x gradlew && ./gradlew --no-daemon assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk "$ROOT/PeNaEstrada.apk"
