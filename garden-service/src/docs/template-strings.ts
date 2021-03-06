/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { resolve } from "path"
import { renderSchemaDescriptionYaml, normalizeDescriptions } from "./config"
import { ProjectConfigContext, ModuleConfigContext } from "../config/config-context"
import { readFileSync, writeFileSync } from "fs"
import * as handlebars from "handlebars"

export function writeTemplateStringReferenceDocs(docsRoot: string) {
  const referenceDir = resolve(docsRoot, "reference")
  const outputPath = resolve(referenceDir, "template-strings.md")

  const projectDescriptions = normalizeDescriptions(ProjectConfigContext.getSchema().describe())
  const projectContext = renderSchemaDescriptionYaml(projectDescriptions, { showRequired: false })
  const moduleDescriptions = normalizeDescriptions(ModuleConfigContext.getSchema().describe())
  const moduleContext = renderSchemaDescriptionYaml(moduleDescriptions, { showRequired: false })

  const templatePath = resolve(__dirname, "templates", "template-strings.hbs")
  const template = handlebars.compile(readFileSync(templatePath).toString())
  const markdown = template({ projectContext, moduleContext })

  writeFileSync(outputPath, markdown)
}

if (require.main === module) {
  writeTemplateStringReferenceDocs(resolve(__dirname, "..", "..", "..", "docs"))
}
