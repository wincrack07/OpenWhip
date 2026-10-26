# OpenWhip

![Whip divider](assets/divider.png)

**Cansado de que tu agente se demore? Esto te ayudará a hacerlo más rápido.**

Un latigo en la barra de menú para **Claude.app**, **ChatGPT/Codex** (app de escritorio) y el **CLI** en terminal (Orca, Terminal, iTerm…). Latigazo para subir el effort (y Fast cuando ya no hay más); caricia para bajarlo. Si lo acaricias, el latigo se vuelve flores y corazones.

## Install + run

```bash
git clone https://github.com/wincrack07/OpenWhip.git
cd OpenWhip
npm install
npm start
```

Windows y Mac listos. En Linux instala `xdotool`:

```bash
sudo apt install xdotool
```

## Controles

1. Abre Claude o ChatGPT (Codex) — o un terminal con el CLI — y deja el compositor vacío.
2. Haz clic una vez en esa ventana para que OpenWhip la recuerde (el tooltip dice `OpenWhip · Claude` o `OpenWhip · ChatGPT`).
3. **Clic** en el icono del latigo (hover no hace nada).
4. Latigazo rápido:
   - El primero avisa.
   - El segundo sube el effort (`medium` → `high` → `xhigh` → `max` → `ultra`).
   - En Claude escribe `/effort …`; en Codex/ChatGPT manda Shift+↑.
   - Si sigues en `ultra`, escribe `/fast on`.
   - Más latigazos: prompts random insultándolo para que termine YA.
5. Arrástralo despacio: flores y corazones, baja effort y `/fast off`.
6. Otro clic suelta el latigo. Clic derecho → Salir.

En macOS, activa **Accesibilidad** para Electron (Ajustes del Sistema → Privacidad y seguridad).

## Basado en

Fork con features para Codex, a partir de [GitFrog1111/OpenWhip](https://github.com/GitFrog1111/OpenWhip).
