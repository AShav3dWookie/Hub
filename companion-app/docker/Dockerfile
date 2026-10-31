# The companion app's build environment: everything Gradle needs to build and test the app,
# so nothing Android has to be installed on the machine. scripts/run.sh builds and runs it;
# CI uses the same image.
#
# Gradle is installed here at a pinned version and the project has no wrapper: the image is
# what makes builds reproducible, so there is no second place for the version to drift.
FROM eclipse-temurin:21-jdk-noble

# Bump these together with app/build.gradle.kts (compileSdk) and the README.
ARG CMDLINE_TOOLS_VERSION=16111833
ARG ANDROID_PLATFORM=android-37.0
ARG BUILD_TOOLS_VERSION=37.0.0
ARG GRADLE_VERSION=9.8.2

ENV ANDROID_HOME=/opt/android-sdk \
    GRADLE_HOME=/opt/gradle \
    # Gradle's and Robolectric's downloads, on named volumes (see scripts/run.sh) so a second
    # build doesn't fetch the internet again.
    GRADLE_USER_HOME=/cache/gradle
ENV PATH="${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${GRADLE_HOME}/bin"

RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip curl \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" -o /tmp/cmdline-tools.zip \
 && mkdir -p "${ANDROID_HOME}/cmdline-tools" \
 && unzip -q /tmp/cmdline-tools.zip -d "${ANDROID_HOME}/cmdline-tools" \
 && mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest" \
 && rm /tmp/cmdline-tools.zip

RUN yes | sdkmanager --licenses > /dev/null \
 && sdkmanager "platforms;${ANDROID_PLATFORM}" "build-tools;${BUILD_TOOLS_VERSION}" > /dev/null

# Checked against the published SHA-256 before it is unpacked.
RUN curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -o /tmp/gradle.zip \
 && echo "$(curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip.sha256")  /tmp/gradle.zip" | sha256sum -c - \
 && unzip -q /tmp/gradle.zip -d /opt \
 && mv "/opt/gradle-${GRADLE_VERSION}" "${GRADLE_HOME}" \
 && rm /tmp/gradle.zip

# The repo is mounted at /repo, so the build can read the app version from package.json.
WORKDIR /repo/companion-app
