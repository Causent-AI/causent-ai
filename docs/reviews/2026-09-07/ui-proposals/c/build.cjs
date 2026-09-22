const path = require('node:path');
const fs = require('node:fs');
const { webpack } = require('next/dist/compiled/webpack/webpack');
function writeLicenses(modules) {
  const packages = new Map();
  function visit(bundledModule) {
    if (bundledModule.resource?.includes('node_modules')) {
      let directory = path.dirname(bundledModule.resource.split('?')[0]);
      while (directory !== path.dirname(directory)) {
        const manifest = path.join(directory, 'package.json');
        if (fs.existsSync(manifest)) {
          const { name, version } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
          packages.set(`${name}@${version}`, directory);
          break;
        }
        directory = path.dirname(directory);
      }
    }
    if (bundledModule.modules) for (const child of bundledModule.modules) visit(child);
  }
  for (const bundledModule of modules) visit(bundledModule);
  const notices = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, directory]) => {
    const files = fs.readdirSync(directory).filter(file => /^(license|licence|copying|notice)(\.|$)/i.test(file));
    if (!files.length) throw new Error(`Missing license notice for ${name}`);
    return `${name}\n${files.map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n')}\n`;
  });
  fs.writeFileSync(path.join(__dirname, 'assets/workbench.LICENSE.txt'), notices.join('\n---\n\n'));
  console.log(`Included license notices for ${packages.size} bundled packages.`);
}
webpack({mode:'production',entry:path.join(__dirname,'src/workbench.js'),output:{path:path.join(__dirname,'assets'),filename:'workbench.js',library:{name:'CausentWorkbench',type:'window'}},devtool:false,optimization:{minimize:false},performance:{hints:false}},(error,stats)=>{
  if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1;return;}
  writeLicenses(stats.compilation.modules);
  console.log(stats.toString({all:false,assets:true}));
});
