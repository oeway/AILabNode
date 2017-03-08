const path = require('path');
const mkdirp = require('mkdirp');
const fs = require('fs');

const widgets = {};
class Widget{
    constructor(id, ddpclient, tasks, worker_dir){
      this.id = id;
      this.ddpclient = ddpclient;
      this.tasks = tasks;
      this.workdir = path.join(worker_dir, 'widget-' + this.id);
      mkdirp(this.workdir, (err)=>{
        if(err) console.error(err);
        this.register();
      });
    };

    register(){
      const code_snippets = this.get('code_snippets');
      const timeout = this.get('config.timeout') || 60000; //ms
      if(code_snippets && 'WORKER_js' in code_snippets){
        try {
          console.log('widget updated: ' + this.id);
          this.writeCodeFiles();
          for(let k in this.tasks){
            if(this.tasks[k].widget.id == this.id){
              if(this.tasks[k].get('status.running'))
                  this.tasks[k].widget_updated = true;
              else
                  this.tasks[k].init();
            }

          }
        } catch (e) {
          console.error(e);
        }
      }
      else{
        console.log('WORKER.js not found.');
        this.script = null;
      }
    };

    writeCodeFiles(){
        const code_snippets = this.get('code_snippets');
        for(let k in code_snippets){
            fs.writeFile(path.join(this.workdir, code_snippets[k].name), code_snippets[k].content, (err)=>{
                if(err) {
                    console.error(err);
                }
            });
        }
    }
    getCode(name){
      const key = name.replace(/\./g, '_');
      return this.ddpclient.collections.widgets[this.id].code_snippets[key].content;
    };

    get(key){
      try{
        const keys = key.split('.');
        let v = this.ddpclient.collections.widgets[this.id];
        for(let i in keys){
          v = v[keys[i]];
        }
        return v;
      }
      catch(e){
        return undefined;
      }
    };
}

exports.Widget = Widget;
exports.widgets = widgets;
