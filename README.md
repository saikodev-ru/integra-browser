# Integra Browser

Стильный браузер для Windows на основе Chromium — в дизайне [Initial](https://github.com/saikodev-ru/initial-web).

## Особенности

- **Chromium-движок** — через Electron, без сторонних модификаций
- **Без телеметрии** — отключены crash reporting, safe browsing, background networking
- **Обход DPI/ТСПУ** — встроенная поддержка [zapret (winws)](https://github.com/bol-van/zapret) и [GoodbyeDPI](https://github.com/ValdikSS/GoodbyeDPI)
- **Дизайн Initial** — graphite palette, lavender→teal accent, Google Sans

## Быстрый старт

```bash
npm install
npm start
```

## Сборка для Windows

```bash
npm run build:win
# → dist/Integra Setup x.x.x.exe
```

## Обход DPI/ТСПУ

Положи бинарник в папку `bypass/` (подробнее в [bypass/README.md](bypass/README.md)):

| Файл | Источник |
|------|----------|
| `winws.exe` + `WinDivert64.dll` | [zapret releases](https://github.com/bol-van/zapret/releases) |
| `goodbyedpi.exe` | [GoodbyeDPI releases](https://github.com/ValdikSS/GoodbyeDPI/releases) |

Кнопка "Обход" появится автоматически при наличии бинарника.

## Горячие клавиши

| Клавиша | Действие |
|---------|----------|
| `Ctrl+T` | Новая вкладка |
| `Ctrl+W` | Закрыть вкладку |
| `Ctrl+L` | Адресная строка |
| `Ctrl+R` / `F5` | Обновить |
| `Ctrl+1..9` | Переключить вкладку |

## Требования

- Node.js 18+
- Windows 10/11 (для bypass — права администратора)
