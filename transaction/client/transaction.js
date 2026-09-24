/* wiki-plugin-transaction — the transaction item type. Its code ships in
   wiki-plugin-timebank: wiki-server serves one item type per plugin package,
   so this file only loads the timebank bundle (the same module the wiki
   loads for timebank items, so it runs once) and registers its transaction
   plugin under this type's name. */
import '/plugins/timebank/timebank.js'

window.plugins.transaction = window.wikiPluginTransaction
