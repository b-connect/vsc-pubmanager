import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as rp from 'request-promise-native';
import * as semver from 'semver';
import { TreeItemCollapsibleState } from 'vscode';

enum UpdateType {
  MinorUpdate,
  MajorUpdate,
  NoUpdate,
  Unknown
}

export class PubSpecProvider implements vscode.TreeDataProvider<Dependency> {

	private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined> = new vscode.EventEmitter<Dependency | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Dependency | undefined> = this._onDidChangeTreeData.event;

  constructor(private workspaceRoot: string) {
    vscode.workspace.onDidSaveTextDocument(e => this.onDocumentChanged(e));
  }

	private onDocumentChanged(changeEvent: vscode.TextDocument): void {
    let file:string = path.basename(changeEvent.fileName);
    if (file === 'pubspec.yaml' || file  === 'pubspec.lock') {
      this.refresh();
    }
  }

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: Dependency): vscode.TreeItem {
		return element;
  }

	getChildren(element?: Dependency): Thenable<Dependency[]> {
		if (!this.workspaceRoot) {
			return Promise.resolve([]);
    }

		return new Promise(resolve => {
			if (element) {
        this.getDepsInPackageVersions(element.label).then(r => {
          resolve(r);
        });
				// resolve(this.getDepsInPackage(path.join(this.workspaceRoot, 'node_modules', element.label, 'package.json')));
			} else {
				const packageYmlPath = path.join(this.workspaceRoot, 'pubspec.yaml');
				if (this.pathExists(packageYmlPath)) {
					resolve(this.getDepsInPackage(packageYmlPath));
				} else {
					resolve([]);
				}
			}
    });
  }

  private getDepsInPackage(packageYmlPath: string):  Thenable<Dependency[]> {
    return new Promise(resolve => {
      const packageYml = yaml.safeLoad(fs.readFileSync(packageYmlPath, 'utf-8'));
      const hasLockFile:Boolean = fs.existsSync(path.dirname(packageYmlPath) + '/pubspec.lock');
      let packageYmlInstalled:any;
      if (hasLockFile) {
        packageYmlInstalled = yaml.safeLoad(fs.readFileSync(path.dirname(packageYmlPath) + '/pubspec.lock', 'utf-8'));
      }
      let p:Promise<Dependency>[] = [];

      Object.keys(packageYml.dependencies).forEach( e => {
        const version = packageYml.dependencies[e];
        let installed = version;
        if (hasLockFile && packageYmlInstalled.packages[e] && packageYmlInstalled.packages[e].version) {
          installed = packageYmlInstalled.packages[e].version;
        }
        if (version !== null && version.sdk) {
          p.push(new Promise(resolve => {
            resolve(new Dependency(
              e,
              'SDK',
              TreeItemCollapsibleState.None,
              UpdateType.NoUpdate
            ));
          }));
          return;
        }
        p.push(rp(`https://pub.dartlang.org/api/packages/${e}`).then((json) => {
            return JSON.parse(json);
          }).then(versions => versions.versions)
          .then((v:any[]) => {
            return v.filter((e) => this.checkVersion(installed, version, e.version));
          }).then((r:any[]) => {
            let cmd = {
              command: 'extension.openPackageOnPub',
              title: '',
              arguments: [e, installed]
            };
            if (r.length === 0) {
              return new Dependency(
                `${e}: ${installed}`,
                installed,
                TreeItemCollapsibleState.None,
                UpdateType.NoUpdate,
                cmd
              );
            }
            return new Dependency(
              `${e}: ${installed}`,
              installed,
              TreeItemCollapsibleState.Collapsed,
              UpdateType.MinorUpdate,
              cmd
            );
          })
        );
      });
      Promise.all(p)
        .then((r) => {
          resolve(r);
        });
    });
  }

  private checkVersion(installedVersion:string , allowedVersion:string , versionToCheck:string): Boolean {
    return semver.satisfies(versionToCheck, allowedVersion) && semver.lt(installedVersion, versionToCheck);
  }

  private getDepsInPackageVersions(moduleName: string):  Thenable<Dependency[]> {
    const module = moduleName.split(':').shift();
    return new Promise(resolve => {
      rp(`https://pub.dartlang.org/api/packages/${module}`).then((result: string) => {
        return JSON.parse(result);
      },(e) => {
        resolve([]);
      }).then((r:any) => {
        var deps:Dependency[] = [];
        deps.push(new Dependency(
          'Latest version: ' + r.latest.version,
          r.latest.version,
          TreeItemCollapsibleState.None,
          UpdateType.MajorUpdate,
        ));
        resolve(deps);
      });
    });
  }

  private pathExists(p: string): boolean {
		try {
			fs.accessSync(p);
		} catch (err) {
			return false;
		}

		return true;
  }

}


class Dependency extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		private version: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly update:UpdateType,
    public readonly command?: vscode.Command,
	) {
    super(`${label}`, collapsibleState);
  }

	get tooltip(): string {
		return `${this.label}-${this.version}`;
  }

  get iconPath(): any {
    let iconToShow:string = "no-update";
    switch (this.update) {
      case UpdateType.MinorUpdate:
        iconToShow = 'update';
      break;
      case UpdateType.MajorUpdate:
        iconToShow = 'update';
      break;
    }
    return {
      light: path.join(__filename, '..', '..', 'resources', 'light', iconToShow , 'dependency.svg'),
      dark: path.join(__filename, '..', '..', 'resources', 'dark', iconToShow , 'dependency.svg')
    };
  }


  contextValue = 'dependency';
}
