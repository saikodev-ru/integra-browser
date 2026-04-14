# Обход DPI/ТСПУ

Положи в эту папку один из следующих бинарников:

## Вариант 1: zapret (winws) — рекомендуется
- Скачай: https://github.com/bol-van/zapret/releases
- Нужен файл: `winws.exe` из папки `binaries/win64/`
- Помести его сюда как `bypass/winws.exe`
- Также нужен `WinDivert64.dll` (из той же архиве) рядом с winws.exe

## Вариант 2: GoodbyeDPI
- Скачай: https://github.com/ValdikSS/GoodbyeDPI/releases
- Нужен файл: `goodbyedpi.exe`
- Помести его сюда как `bypass/goodbyedpi.exe`

Браузер автоматически обнаружит бинарник и покажет кнопку "Обход" в панели навигации.
При нажатии кнопки процесс запускается с параметрами для обхода российского ТСПУ.

## Флаги запуска

### winws (запуск Integral. делает автоматически):
```
--wf-tcp=80,443 --wf-udp=443,50000-65535
--dpi-desync=split2 --dpi-desync-ttl=5
--dpi-desync-repeats=11
```

### GoodbyeDPI (запуск Integral. делает автоматически):
```
-p -r -s -n -e 40 --dns-addr 77.88.8.8 --dns-port 53
```

## Важно
- Запускай Integral. от имени администратора, если bypass не стартует
- winws/GoodbyeDPI требуют WinDivert (обычно входит в пакет)
- Лицензии bypass-инструментов — смотри в их репозиториях
