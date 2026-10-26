# FoundryVTT - Babele

> **MGK fork** of [riccisi/foundryvtt-babele](https://gitlab.com/riccisi/foundryvtt-babele) 2.9.1, released on GitHub. Change: Trusted Players and above can use the actor sheet "Translate" control.
> Install: `https://github.com/EduardoJGilA/foundryvtt-babele/releases/latest/download/module.json`

Babele is a module for runtime translation of Compendium packs.

The use of Babele therefore allows you to avoid making copies of the compendiums for the sole purpose of translating the contents, thus losing the possibility of receiving updates of the compendium when the module/system that provides the contents is itself updated.

Babele accomplishes this task by obtaining translation from configuration files in json format (provided by you and stored in a local directory or distributed via a module) and applies them on the original compendium, overwriting the mapped properties of the entity in memory without altering the original content.

## Documentation
Make sure to read the complete documentation available at the following [link](https://gitlab.com/riccisi/foundryvtt-babele/-/wikis/Docs)

## Compatibility
Babele `2.8.x` targets Foundry VTT `14`.
Babele `2.7.x` targets Foundry VTT `13`.
For Foundry `12`, stay on the last compatible `2.6.x` release line.

## Example
As a reference, see the Italian translation of the dnd5e compendium present in the IT translation module:
[https://gitlab.com/riccisi/foundryvtt-dnd5e-lang-it-it](https://gitlab.com/riccisi/foundryvtt-dnd5e-lang-it-it)

## Feedback
Every suggestion/feedback are appreciated, if so, please contact me on discord (Simone#6710)

## Acknowledgments

* Thanks to @ariakas81 for the collaboration in the Italian translation of the Dnd 5e SRD.
* Thanks to @tposney#1462 for the valuable tips.

## License

FoundryVTT Babele is a module for Foundry VTT by Simone and is licensed under
a [Creative Commons Attribution 4.0 International License](http://creativecommons.org/licenses/by/4.0/).

This work is licensed under Foundry Virtual
Tabletop [EULA - Limited License Agreement for module development v 0.1.6](http://foundryvtt.com/pages/license.html).
