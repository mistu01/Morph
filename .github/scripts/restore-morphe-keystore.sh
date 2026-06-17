#!/usr/bin/env bash
set -euo pipefail

if [ -z "${APK_KEYSTORE_B64:-}" ]; then
  exit 0
fi

if [ -z "${APK_KEYSTORE_PASSWORD:-}" ]; then
  echo "::error::APK_KEYSTORE_B64 is set, but APK_KEYSTORE_PASSWORD is missing."
  exit 1
fi

export APK_KEYSTORE_ENTRY_PASSWORD="${APK_KEYSTORE_ENTRY_PASSWORD:-$APK_KEYSTORE_PASSWORD}"
export APK_KEYSTORE_ALIAS="${APK_KEYSTORE_ALIAS:-mistu}"

mkdir -p .secrets
printf '%s' "$APK_KEYSTORE_B64" | tr -d '[:space:]' | base64 -d > .secrets/mistu-release-source.keystore

cat > .secrets/ConvertKeystore.java <<'JAVA'
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.Key;
import java.security.KeyStore;
import java.security.Provider;
import java.security.Security;
import java.security.cert.Certificate;
import org.bouncycastle.jce.provider.BouncyCastleProvider;

public final class ConvertKeystore {
  private record LoadedStore(KeyStore store, String type) {}

  public static void main(String[] args) throws Exception {
    Path input = Path.of(args[0]);
    Path output = Path.of(args[1]);
    char[] storePassword = requiredEnv("APK_KEYSTORE_PASSWORD").toCharArray();
    char[] entryPassword = envOr("APK_KEYSTORE_ENTRY_PASSWORD", requiredEnv("APK_KEYSTORE_PASSWORD")).toCharArray();
    String alias = envOr("APK_KEYSTORE_ALIAS", "mistu");

    Provider bc = new BouncyCastleProvider();
    if (Security.getProvider(bc.getName()) == null) Security.addProvider(bc);

    LoadedStore loaded = loadStore(input, storePassword);
    Key key = loaded.store().getKey(alias, entryPassword);
    if (key == null) {
      throw new IllegalStateException("Signing key alias not found in " + loaded.type() + " keystore: " + alias);
    }

    Certificate[] chain = loaded.store().getCertificateChain(alias);
    if (chain == null || chain.length == 0) {
      Certificate certificate = loaded.store().getCertificate(alias);
      if (certificate == null) {
        throw new IllegalStateException("No certificate found for signing key alias: " + alias);
      }
      chain = new Certificate[] { certificate };
    }

    KeyStore bks = KeyStore.getInstance("BKS", "BC");
    bks.load(null, storePassword);
    bks.setKeyEntry(alias, key, entryPassword, chain);

    try (OutputStream stream = Files.newOutputStream(output)) {
      bks.store(stream, storePassword);
    }
  }

  private static LoadedStore loadStore(Path path, char[] password) throws Exception {
    Exception last = null;
    for (String type : new String[] { "JKS", "PKCS12", "BKS" }) {
      try {
        KeyStore store = "BKS".equals(type)
          ? KeyStore.getInstance(type, "BC")
          : KeyStore.getInstance(type);
        try (InputStream stream = Files.newInputStream(path)) {
          store.load(stream, password);
        }
        return new LoadedStore(store, type);
      } catch (Exception error) {
        last = error;
      }
    }

    throw new IllegalStateException("Could not load signing keystore as JKS, PKCS12, or BKS.", last);
  }

  private static String requiredEnv(String name) {
    String value = System.getenv(name);
    if (value == null || value.isEmpty()) {
      throw new IllegalStateException(name + " is required");
    }
    return value;
  }

  private static String envOr(String name, String fallback) {
    String value = System.getenv(name);
    return value == null || value.isEmpty() ? fallback : value;
  }
}
JAVA

javac -cp .cache/tools/morphe-cli.jar .secrets/ConvertKeystore.java
java -cp ".cache/tools/morphe-cli.jar:.secrets" ConvertKeystore \
  .secrets/mistu-release-source.keystore \
  .secrets/mistu-release.bks

echo "KEYSTORE_FILE=.secrets/mistu-release.bks" >> "$GITHUB_ENV"
