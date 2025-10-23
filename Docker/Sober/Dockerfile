FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt update && apt install -y \
    flatpak \
    gnome-session \
    gnome-terminal \
    x11-utils \
    dbus-x11 \
    libx11-dev \
    && flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo \
    && flatpak install -y flathub org.vinegarhq.Sober

CMD ["flatpak", "run", "org.vinegarhq.Sober"]