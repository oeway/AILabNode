# Node.js Toolkits for AILab platform (WIP)

# Installation


```bash
git clone https://github.com/oeway/AILabNode.git
cd AILabNode

# skip the following command if have node.js installed, gcc/4.9 is required
sh install_node.sh

# if the following doesn't work, you need to run `export PATH=$HOME/local/bin:$PATH` and run it again.
npm install
```

# Getting Start
You need to login to AILab.AI platform and then goto "Widget Workers", create a new worker, and get the id and token.

As an example, we get a worker `id=iJX99fYEdfasigEAe` and `token=jguogvqlerkygcc`, we will use them as arguments for the worker scripts.

Then, to run the actual worker, you can open a terminal window and type the following commands:
```bash
# start worker
node index.js --id iJX99fYEdfasigEAe --token jguogvqlerkygcc
```

And you will see the worker running on the platform, now you are ready to go, try to create a widget and add the worker you just created. In the "Code" tab in a widget editor, you can add one code file named "WORKER.js" with the type "javascript" which will perform the actuall task on the worker node.

```js
$ctrl.run = function(){
    const cmd = 'python';
    const args = ['-c', 'print("hello world")'];

    $ctrl.process = child_process.spawn(cmd, args, {cwd:$ctrl.task.workdir});
    $ctrl.process.stdout.on('data', (data)=>{
      console.log(data.toString());
      // parse the console output here
      $ctrl.task.set({'status.info': data.toString()});
    });
    $ctrl.process.on('error', (e)=>{
      console.error(e.toString());
      $ctrl.task.set({'status.error': e.toString()});
    });
}
$ctrl.stop = function(){
    $ctrl.process.kill();
}
```

# The 3-way binding of the `$ctrl.task` object
To enable a simple and seamless communication between the web GUI and the worker, AILab has an javascript object which is synchronized in real-time between the web GUI, the server database and the worker(3-way binding). It's a json object can be accessed with `$ctrl.task`, and has the following structure:
```json
{
"name": "my task",
"config": {},
"input": {},
"output": {},
"status": {
  "stage":"loading",
  "progress": 55,
  "running": true,
  "info": "",
  "error": ""
  }
}
```
Generally, you can change any of the above fields by using `$ctrl.task.set(key, value)` syntax, but they are designed for different purposes. Here is a general guide for using these fields:
 * use `$ctrl.task.config` for saving and updating settings, configurations of the task.
 * use `$ctrl.task.input` for the input of the task, usually, it can be a file path, an url, some numbers or string which generate by another task.
 * use `$ctrl.task.output` for the output of the task, it can be a file path or url, some numbers or string produced by the task.
 * the fields in `$ctrl.task.status` is fixed and they are linked to the default GUI, so for example, you can change `$ctrl.task.status.progress` to change the display a progress bar showed in your task. Similarly, you can show some infomation or error message with `$ctrl.task.status.info` and `$ctrl.task.status.error`.
 * use `$ctrl.task.set(key, value)` to set one field, for example: `$ctrl.task.set("status.progress", 45);`.
 * use `$ctrl.task.set({key1:value1, key2:value2})` to set multiple fields, for example `$ctrl.task.set({"status.error":"open file error", "input.file": "XX.png"})`
 * use `$ctrl.task.get(key)` syntax to get value, for example: `var x = $ctrl.task.get("config.x");`
 
Once you set the variables, it will be synchronized across all the web pages and the worker in real-time, it's a reactive 3-way binding.
So it will enables you to take input form the web GUI and use it immediately on the worker. For example:
In the `PANEL.html`, you have:
```html
x: <input type="number" ng-model="$ctrl.task.config.x">
y: {{$ctrl.task.output.y}}
```
And you can do this in the `WORKER.js`:
```javascript
x = $ctrl.task.get('config.x');
y = x*23+8;

$ctrl.task.set('output.y', y);
// then you should be able to see the updated y on your web GUI.
```
