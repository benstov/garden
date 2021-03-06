/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import Bluebird = require("bluebird")
import { ResolvableProps } from "bluebird"
import * as exitHook from "async-exit-hook"
import * as klaw from "klaw"
import * as yaml from "js-yaml"
import * as Cryo from "cryo"
import * as _spawn from "cross-spawn"
import { pathExists, readFile, writeFile } from "fs-extra"
import { join, basename, win32, posix } from "path"
import { find, pick, difference, fromPairs, uniqBy } from "lodash"
import { TimeoutError, ParameterError, RuntimeError, GardenError } from "../exceptions"
import { isArray, isPlainObject, extend, mapValues, pickBy } from "lodash"
import highlight from "cli-highlight"
import chalk from "chalk"
import { safeDump } from "js-yaml"
import { GARDEN_DIR_NAME } from "../constants"
import { createHash } from "crypto"
// NOTE: Importing from ignore/ignore doesn't work on Windows
const ignore = require("ignore")

// shim to allow async generator functions
if (typeof (Symbol as any).asyncIterator === "undefined") {
  (Symbol as any).asyncIterator = Symbol("asyncIterator")
}

export type HookCallback = (callback?: () => void) => void

const exitHookNames: string[] = [] // For debugging/testing/inspection purposes

export type ValueOf<T> = T[keyof T]
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>
export type Diff<T, U> = T extends U ? never : T
export type Nullable<T> = { [P in keyof T]: T[P] | null }
// From: https://stackoverflow.com/a/49936686/5629940
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends Array<infer U> ? Array<DeepPartial<U>>
  : T[P] extends ReadonlyArray<infer V> ? ReadonlyArray<DeepPartial<V>>
  : DeepPartial<T[P]>
}
export type Unpacked<T> =
  T extends (infer U)[] ? U
  : T extends (...args: any[]) => infer V ? V
  : T extends Promise<infer W> ? W
  : T

const MAX_BUFFER_SIZE = 1024 * 1024

export function shutdown(code) {
  // This is a good place to log exitHookNames if needed.
  process.exit(code)
}

export function registerCleanupFunction(name: string, func: HookCallback) {
  exitHookNames.push(name)
  exitHook(func)
}

export function getPackageVersion(): String {
  const version = require("../../package.json").version
  return version
}

/*
  Warning: Don't make any async calls in the loop body when using this function, since this may cause
  funky concurrency behavior.
  */
export async function* scanDirectory(path: string, opts?: klaw.Options): AsyncIterableIterator<klaw.Item> {
  let done = false
  let resolver
  let rejecter

  klaw(path, opts)
    .on("data", (item) => {
      if (item.path !== path) {
        resolver(item)
      }
    })
    .on("error", (err) => {
      rejecter(err)
    })
    .on("end", () => {
      done = true
      resolver()
    })

  // a nice little trick to turn the stream into an async generator
  while (!done) {
    const promise: Promise<klaw.Item> = new Promise((resolve, reject) => {
      resolver = resolve
      rejecter = reject
    })

    yield await promise
  }
}

export async function getChildDirNames(parentDir: string): Promise<string[]> {
  let dirNames: string[] = []
  // Filter on hidden dirs by default. We could make the filter function a param if needed later
  const filter = (item: string) => !basename(item).startsWith(".")

  for await (const item of scanDirectory(parentDir, { depthLimit: 0, filter })) {
    if (!item || !item.stats.isDirectory()) {
      continue
    }
    dirNames.push(basename(item.path))
  }
  return dirNames
}

export interface Ignorer {
  ignores: (path: string) => boolean
}

export async function getIgnorer(rootPath: string): Promise<Ignorer> {
  // TODO: this doesn't handle nested .gitignore files, we should revisit
  const gitignorePath = join(rootPath, ".gitignore")
  const gardenignorePath = join(rootPath, ".gardenignore")
  const ig = ignore()

  if (await pathExists(gitignorePath)) {
    ig.add((await readFile(gitignorePath)).toString())
  }

  if (await pathExists(gardenignorePath)) {
    ig.add((await readFile(gardenignorePath)).toString())
  }

  // should we be adding this (or more) by default?
  ig.add([
    "node_modules",
    ".git",
    "*.log",
    GARDEN_DIR_NAME,
    // TODO Take a better look at the temp files mutagen creates
    ".mutagen-*",
  ])

  return ig
}

export async function sleep(msec) {
  return new Promise(resolve => setTimeout(resolve, msec))
}

export interface SpawnOpts {
  timeout?: number
  cwd?: string
  data?: Buffer
  ignoreError?: boolean
  env?: { [key: string]: string | undefined }
  tty?: boolean
}

export interface SpawnOutput {
  code: number
  output: string
  stdout?: string
  stderr?: string
  proc: any
}

/**
 * Truncates the first n characters from a string where n equals the number by
 * which the string byte length exceeds the MAX_BUFFER_SIZE.
 *
 * Note that a utf8 character can be 1-4 bytes so this is a naive but inexpensive approach.
 */
function naivelyTruncateBytes(str: string) {
  const overflow = Buffer.byteLength(str, "utf8") - MAX_BUFFER_SIZE
  if (overflow > 0) {
    str = str.substr(overflow)
  }
  return str
}

// TODO Dump output to a log file if it exceeds the MAX_BUFFER_SIZE
export function spawn(cmd: string, args: string[], opts: SpawnOpts = {}) {
  const { timeout = 0, cwd, data, ignoreError = false, env, tty } = opts

  const stdio = tty ? "inherit" : "pipe"
  const proc = _spawn(cmd, args, { cwd, env, stdio })

  const result: SpawnOutput = {
    code: 0,
    output: "",
    stdout: "",
    stderr: "",
    proc,
  }

  let _process = <any>process

  if (tty) {
    if (data) {
      throw new ParameterError(`Cannot pipe to stdin when tty=true`, { cmd, args, opts })
    }

    _process.stdin.setEncoding("utf8")

    // raw mode is not available if we're running without a TTY
    _process.stdin.setRawMode && _process.stdin.setRawMode(true)

  } else {
    // We ensure the output strings never exceed the MAX_BUFFER_SIZE
    proc.stdout!.on("data", (s) => {
      result.output = naivelyTruncateBytes(result.output + s)
      result.stdout! = naivelyTruncateBytes(result.stdout! + s)
    })

    proc.stderr!.on("data", (s) => {
      result.stderr! = naivelyTruncateBytes(result.stderr! + s)
    })

    if (data) {
      proc.stdin!.end(data)
    }
  }

  return new Promise<SpawnOutput>((resolve, reject) => {
    let _timeout

    const _reject = (err: GardenError) => {
      extend(err.detail, <any>result)
      reject(err)
    }

    if (timeout > 0) {
      _timeout = setTimeout(() => {
        proc.kill("SIGKILL")
        _reject(new TimeoutError(`${cmd} timed out after ${timeout} seconds.`, { cmd, args, opts }))
      }, timeout * 1000)
    }

    proc.on("close", (code) => {
      _timeout && clearTimeout(_timeout)
      result.code = code

      if (code === 0 || ignoreError) {
        resolve(result)
      } else {
        const nLinesToShow = 100
        const output = result.output.split("\n").slice(-nLinesToShow).join("\n")
        const msg =
          `Command failed with code ${code}: ${cmd} ${args.join(" ")}\n\n` +
          `${result.stderr}\n` +
          `Here are the last ${nLinesToShow} lines of the output:\n\n ${output}`
        _reject(new RuntimeError(msg, { cmd, args, opts, result }))
      }
    })
  })
}

export async function dumpYaml(yamlPath, data) {
  return writeFile(yamlPath, yaml.safeDump(data, { noRefs: true }))
}

/**
 * Encode multiple objects as one multi-doc YAML file
 */
export function encodeYamlMulti(objects: object[]) {
  return objects.map(s => safeDump(s, { noRefs: true }) + "---\n").join("")
}

/**
 * Encode and write multiple objects as a multi-doc YAML file
 */
export async function dumpYamlMulti(yamlPath: string, objects: object[]) {
  return writeFile(yamlPath, encodeYamlMulti(objects))
}

/**
 * Splits the input string on the first occurrence of `delimiter`.
 */
export function splitFirst(s: string, delimiter: string) {
  const parts = s.split(delimiter)
  return [parts[0], parts.slice(1).join(delimiter)]
}

/**
 * Recursively process all values in the given input,
 * walking through all object keys _and array items_.
 */
export function deepMap<T extends object, U extends object = T>(
  value: T | Iterable<T>, fn: (value: any, key: string | number) => any,
): U | Iterable<U> {
  if (isArray(value)) {
    return value.map(fn)
  } else if (isPlainObject(value)) {
    return <U>mapValues(value, v => deepMap(v, fn))
  } else {
    return <U>value
  }
}

/**
 * Recursively filter all keys and values in the given input,
 * walking through all object keys _and array items_.
 */
export function deepFilter<T extends object, U extends object = T>(
  value: T | Iterable<T>, fn: (value: any, key: string | number) => boolean,
): U | Iterable<U> {
  if (isArray(value)) {
    return <Iterable<U>>value.filter(fn).map(v => deepFilter(v, fn))
  } else if (isPlainObject(value)) {
    return <U>mapValues(pickBy(<U>value, fn), v => deepFilter(v, fn))
  } else {
    return <U>value
  }
}

/**
 * Recursively resolves all promises in the given input,
 * walking through all object keys and array items.
 */
export async function deepResolve<T>(
  value: T | Iterable<T> | Iterable<PromiseLike<T>> | ResolvableProps<T>,
): Promise<T | Iterable<T> | { [K in keyof T]: T[K] }> {
  if (isArray(value)) {
    return await Bluebird.map(value, deepResolve)
  } else if (isPlainObject(value)) {
    return await Bluebird.props(<ResolvableProps<T>>mapValues(<ResolvableProps<T>>value, deepResolve))
  } else {
    return Promise.resolve(<T>value)
  }
}

/**
 * Recursively maps over all keys in the input and resolves the resulting promises,
 * walking through all object keys and array items.
 */
export async function asyncDeepMap<T>(
  obj: T, mapper: (value) => Promise<any>, options?: Bluebird.ConcurrencyOption,
): Promise<T> {
  if (isArray(obj)) {
    return <any>Bluebird.map(obj, v => asyncDeepMap(v, mapper, options), options)
  } else if (isPlainObject(obj)) {
    return <T>fromPairs(
      await Bluebird.map(
        Object.entries(obj),
        async ([key, value]) => [key, await asyncDeepMap(value, mapper, options)],
        options,
      ),
    )
  } else {
    return mapper(obj)
  }
}

export function omitUndefined(o: object) {
  return pickBy(o, (v: any) => v !== undefined)
}

/**
 * Recursively go through an object or array and strip all keys with undefined values, as well as undefined
 * values from arrays. Note: Also iterates through arrays recursively.
 */
export function deepOmitUndefined(obj: object) {
  return deepFilter(obj, v => v !== undefined)
}

export function serializeObject(o: any): string {
  return Buffer.from(Cryo.stringify(o)).toString("base64")
}

export function deserializeObject(s: string) {
  return Cryo.parse(Buffer.from(s, "base64"))
}

export function serializeValues(o: { [key: string]: any }): { [key: string]: string } {
  return mapValues(o, serializeObject)
}

export function deserializeValues(o: object) {
  return mapValues(o, deserializeObject)
}

export function getEnumKeys(Enum) {
  return Object.values(Enum).filter(k => typeof k === "string") as string[]
}

export function highlightYaml(s: string) {
  return highlight(s, {
    language: "yaml",
    theme: {
      keyword: chalk.white.italic,
      literal: chalk.white.italic,
      string: chalk.white,
    },
  })
}

export async function loadYamlFile(path: string): Promise<any> {
  const fileData = await readFile(path)
  return yaml.safeLoad(fileData.toString())
}

export interface ObjectWithName {
  name: string
}

export function getNames<T extends ObjectWithName>(array: T[]) {
  return array.map(v => v.name)
}

export function findByName<T extends ObjectWithName>(array: T[], name: string): T | undefined {
  return find(array, ["name", name])
}

export function uniqByName<T extends ObjectWithName>(array: T[]): T[] {
  return uniqBy(array, item => item.name)
}

/**
 * Converts a Windows-style path to a cygwin style path (e.g. C:\some\folder -> /cygdrive/c/some/folder).
 */
export function toCygwinPath(path: string) {
  const parsed = win32.parse(path)
  const drive = parsed.root.split(":")[0].toLowerCase()
  const dirs = parsed.dir.split(win32.sep).slice(1)
  const cygpath = posix.join("/cygdrive", drive, ...dirs, parsed.base)

  // make sure trailing slash is retained
  return path.endsWith(win32.sep) ? cygpath + posix.sep : cygpath
}

/**
 * Converts a string identifier to the appropriate casing and style for use in environment variable names.
 * (e.g. "my-service" -> "MY_SERVICE")
 */
export function getEnvVarName(identifier: string) {
  return identifier.replace("-", "_").toUpperCase()
}

/**
 * Picks the specified keys from the given object, and throws an error if one or more keys are not found.
 */
export function pickKeys<T extends object, U extends keyof T>(obj: T, keys: U[], description = "key"): Pick<T, U> {
  const picked = pick(obj, ...keys)

  const missing = difference(<string[]>keys, Object.keys(picked))

  if (missing.length) {
    throw new ParameterError(`Could not find ${description}(s): ${missing.map((k, _) => k).join(", ")}`, {
      missing,
      available: Object.keys(obj),
    })
  }

  return picked
}

export function throwOnMissingNames<T extends ObjectWithName>(names: string[], entries: T[], description: string) {
  const available = getNames(entries)
  const missing = difference(names, available)

  if (missing.length) {
    throw new ParameterError(`Could not find ${description}(s): ${missing.join(", ")}`, { available, missing })
  }
}

export function hashString(s: string, length: number) {
  const urlHash = createHash("sha256")
  urlHash.update(s)
  return urlHash.digest("hex").slice(0, length)
}
