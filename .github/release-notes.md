**EasyTizen {{VERSION}}** — простой способ устанавливать приложения на телевизоры Samsung: с компьютера или прямо с телефона.

## Какой файл скачать

| Устройство | Файл | Как установить |
|---|---|---|
| 📱 **Android** 7.0 и новее (телефон, планшет) | `EasyTizen-Android.apk` | Открыть файл на устройстве и разрешить установку — [инструкция](https://github.com/volnalabs/TV-Deploy#android) |
| 💻 **Windows** 10 и 11 (64-bit) | `EasyTizen-Windows-x64-Setup.exe` | Запустить установщик — [инструкция](https://github.com/volnalabs/TV-Deploy#windows) |
| 💻 **macOS** 10.15 и новее (Apple и Intel) | `EasyTizen-macOS.app.tar.gz` | Открыть — появится EasyTizen; перетащить в «Программы» — [первый запуск](https://github.com/volnalabs/TV-Deploy#macos) |
| 🐧 **Linux** (любой дистрибутив, 64-bit) | `EasyTizen-Linux-x64.AppImage` | `chmod +x`, затем запустить — [инструкция](https://github.com/volnalabs/TV-Deploy#linux) |

По одному файлу на систему. `latest.json` — служебный файл для автообновления, скачивать его не нужно. Файлы `Source code` нужны только тем, кто собирает приложение сам.

**Дальше:** [как включить режим разработчика на телевизоре](https://github.com/volnalabs/TV-Deploy#samsung-tv) · [как подключить телевизор, создать сертификат и установить приложение](https://github.com/volnalabs/TV-Deploy#first-install) · [вопросы и ответы](https://github.com/volnalabs/TV-Deploy#faq)

## Что изменилось

{{CHANGES}}

## Подпись установщиков

{{SIGNING}}

## Контрольные суммы SHA-256

{{SHA256_TABLE}}

Проверка: `sha256sum <файл>` (Linux), `shasum -a 256 <файл>` (macOS) или `Get-FileHash <файл> -Algorithm SHA256` (Windows PowerShell) — сравните с таблицей.

**[Полная история изменений →](https://github.com/volnalabs/TV-Deploy/blob/main/CHANGELOG.md)** · **[Инструкции и скриншоты →](https://github.com/volnalabs/TV-Deploy#readme)**
