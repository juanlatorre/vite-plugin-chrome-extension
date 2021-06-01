import path from "path";
import fs from "fs";
import vite, { AliasOptions, Plugin } from "vite";
import chalk from "chalk";
import { RollupOutput, WatcherOptions } from "rollup";
import { IComponentProcessor } from "../common";
import { PopupProcessorCache } from "./cache";
import { ChromeExtensionManifest } from "@/manifest";
import { ChromeExtensionModule } from "@/common/models";

export interface PopupProcessorOptions {
    root?: string;
    outDir?: string;
    alias?: AliasOptions;
    plugins?: Plugin[];
}

export interface NormalizedPopupProcessorOptions {
    root: string;
    outDir: string;
    alias: AliasOptions;
    plugins: Plugin[];
}

const DefaultPopupProcessorOptions: NormalizedPopupProcessorOptions = {
    root: process.cwd(),
    outDir: path.join(process.cwd(), "dist"),
    alias: [],
    plugins: [],
};

export class PopupProcessor implements IComponentProcessor {
    private _options: NormalizedPopupProcessorOptions;
    private _cache = new PopupProcessorCache();

    public async resolve(manifest: ChromeExtensionManifest): Promise<string[]> {
        if (manifest.action?.default_popup) {
            const entry = manifest.action.default_popup;
            if (!this._cache.module || entry !== this._cache.entry) {
                console.log(chalk`{blue rebuilding popup}`);
                this._cache.module = (await this.run(entry)).output;
                this._cache.entry = entry;
            }
            return this._cache.module.map(chunk => {
                const modules = [];
                if (chunk.type === "chunk") {
                    modules.push(...Object.keys(chunk.modules));
                    modules.push(...chunk.imports);
                }
                return modules;
            }).reduce((result, modules) => result.concat(modules), []);
        } else {
            return [];
        }
    }

    public async build(): Promise<ChromeExtensionModule | undefined> {
        if (!this._cache.entry || !this._cache.module) { return undefined; }
        const outputPath = path.resolve(this._options.root, this._options.outDir);
        if (fs.existsSync(outputPath)) {
            this._cache.module.forEach(chunk => {
                const outputFilePath = path.resolve(outputPath, chunk.fileName);
                const dirName = path.dirname(outputFilePath);
                if (!fs.existsSync(dirName)) { fs.mkdirSync(dirName); }
                if (chunk.type === "chunk") {
                    fs.writeFileSync(outputFilePath, chunk.code);
                } else {
                    fs.writeFileSync(outputFilePath, chunk.source);
                }
            });
        }

        const entryBundle = this._cache.module.find(module => {
            if (module.type === "chunk") {
                return module.facadeModuleId === path.resolve(this._options.root, this._cache.entry || "");
            } else {
                return module.fileName === this._cache.entry;
            }
        });

        return {
            entry: this._cache.entry,
            bundle: entryBundle!.fileName,
        };
    }

    public constructor(options: PopupProcessorOptions = {}) {
        this._options = this.normalizeOptions(options);
    }

    private normalizeOptions(options: PopupProcessorOptions): NormalizedPopupProcessorOptions {
        const normalizedOptions = { ...options };

        if (!normalizedOptions.plugins) { normalizedOptions.plugins = DefaultPopupProcessorOptions.plugins; }
        return normalizedOptions as NormalizedPopupProcessorOptions;
    }


    public async run(entry: string): Promise<RollupOutput> {
        return await vite.build({
            root: this._options.root,
            resolve: {
                alias: this._options.alias,
            },
            plugins: this._options.plugins,
            build: {
                rollupOptions: { input: path.resolve(this._options.root, entry) },
                emptyOutDir: false,
                write: false,
            },
            configFile: false, // must set to false, to avoid load config from vite.config.ts
        }) as RollupOutput;
    }
}
