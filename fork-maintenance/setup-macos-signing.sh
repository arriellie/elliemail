#!/bin/sh
# One-time local signing identity. Private material stays outside the repository.
set -eu
[ "$(uname -s)" = Darwin ] || { echo 'macOS is required' >&2; exit 1; }
config_dir="$HOME/Library/Application Support/Ellie Mail Signing"
umask 077
mkdir -p "$config_dir"
cd "$config_dir"
if [ ! -f identity.pem ]; then
	openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
		-subj '/CN=Ellie Mail Local Signing/' \
		-addext 'basicConstraints=critical,CA:FALSE' \
		-addext 'keyUsage=critical,digitalSignature' \
		-addext 'extendedKeyUsage=critical,codeSigning' \
		-keyout identity.key -out identity.pem 2>certificate.log
fi
if [ ! -f signing.keychain-db ]; then
	openssl rand -hex 32 > keychain-password
	security create-keychain -p "$(cat keychain-password)" "$config_dir/signing.keychain-db"
	security set-keychain-settings "$config_dir/signing.keychain-db"
fi
security unlock-keychain -p "$(cat keychain-password)" "$config_dir/signing.keychain-db"
if ! security find-certificate -c 'Ellie Mail Local Signing' "$config_dir/signing.keychain-db" >/dev/null 2>&1; then
	/usr/bin/openssl pkcs12 -export -inkey identity.key -in identity.pem -out identity.p12 -passout file:keychain-password
	security import identity.p12 -k "$config_dir/signing.keychain-db" -P "$(cat keychain-password)" -T /usr/bin/codesign
	rm -f identity.p12 identity.key
fi
# Restrict trust to code signing in the current user's trust settings.
echo 'Approve the one-time macOS certificate trust prompt, if shown.'
security add-trusted-cert -r trustRoot -p codeSign -k "$config_dir/signing.keychain-db" identity.pem
security set-key-partition-list -S apple-tool:,apple: -s -k "$(cat keychain-password)" "$config_dir/signing.keychain-db" >/dev/null
fingerprint=$(openssl x509 -in identity.pem -noout -fingerprint -sha1 | sed 's/.*=//; s/://g')
# Verify actual signing before enabling the configuration for future builds.
cp /usr/bin/true signing-check
codesign --force --sign "$fingerprint" --keychain "$config_dir/signing.keychain-db" --timestamp=none signing-check
codesign --verify --strict signing-check
rm -f signing-check
printf '%s\n' "$fingerprint" > identity.sha1
printf 'Local signing ready: %s\n' "$config_dir"
