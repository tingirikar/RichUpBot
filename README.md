# RUBOT

an intelligent bot, which autonomously plays richup.io games!


## 🚀 Installation & Setup

1. **Prerequisites:**
   * Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
   * Install [Ollama](https://ollama.com/) and run `ollama run qwen2.5:7b`.

2. **Build the Userscript:**
   ```bash
   npm install
   npm run build
   ```

3. **Install to Browser:**
   * Open Tampermonkey in your browser $\rightarrow$ **Create a new script**.
   * Copy and paste the entire contents of `dist/RichUpBot.user.js`.
   * Save and navigate to [richup.io](https://richup.io).
