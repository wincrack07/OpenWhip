# OpenWhip

![Whip divider](assets/divider.png)

**Cansado de que tu agente se demore? Esto te ayudará a hacerlo más rápido.**

Un latigo en la barra de menú para Codex: latigazo para subir el effort (y Fast cuando ya no hay más), caricia para bajarlo. Si lo acaricias, el latigo se vuelve flores y corazones.

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

1. Deja Codex al frente, con el compositor vacío.
2. **Clic** en el icono del latigo (hover no hace nada).
3. Latigazo rápido:
   - El primero avisa.
   - El segundo sube el effort (`medium` → `high` → `xhigh` → `max` → `ultra`).
   - Si sigues en `ultra`, escribe `/fast on`.
4. Arrástralo despacio: flores y corazones, baja un paso de effort y escribe `/fast off`.
5. Otro clic suelta el latigo. Clic derecho → Salir.

En macOS, activa **Accesibilidad** para Electron (Ajustes del Sistema → Privacidad y seguridad).

## Basado en

Fork con features para Codex, a partir de [GitFrog1111/OpenWhip](https://github.com/GitFrog1111/OpenWhip).
