import * as path from 'path';
import * as fs from 'fs';

export class Config {
  constructor(name: string, defaults: Record<string, any>) {
    this.name = name;
    this.filepath = path.join(process.env['HOME'] ?? '.', `.${name}-config.json`);
    // l('config', this.filepath, fs.readFileSync(this.filepath, 'utf8'));
    if (!fs.existsSync(this.filepath)) {
      console.error(`config file not found at ${this.filepath}, creating it.`);
      fs.writeFileSync(this.filepath, JSON.stringify(defaults), 'utf8');
    }
    this.config = JSON.parse(fs.readFileSync(this.filepath, 'utf8'));
  }
  name: string;
  config: Record<string, any>;
  filepath: string;

  set(field: string, value: any) {
    this.config[field] = value;
    console.error(`setting config field ${field} to ${value}`, new Error().stack, this.config);
    fs.writeFileSync(this.filepath, JSON.stringify(this.config), 'utf8');
  }
  get(field: string) {
    return this.config[field];
  }
}

