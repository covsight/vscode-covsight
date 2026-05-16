const esbuild = require('esbuild');
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Plugin that logs build start/finish so VS Code's task runner can detect completion. */
const watchLogPlugin = {
  name: 'watch-log',
  setup(build) {
    build.onStart(() => { process.stdout.write('[watch] build started\n'); });
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        process.stderr.write('[watch] build failed\n');
      } else {
        process.stdout.write('[watch] build finished\n');
      }
    });
  },
};

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  plugins: watch ? [watchLogPlugin] : [],
};

if (watch) {
  esbuild.context(buildOptions).then(ctx => ctx.watch()).catch(() => process.exit(1));
} else {
  esbuild.build(buildOptions).catch(() => process.exit(1));
}
