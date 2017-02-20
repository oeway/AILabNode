const fs = require('fs');
const request = require('request');

exports.download = function(url, dest, cb) {
    var file = fs.createWriteStream(dest);
    var sendReq = request.get(url);

    // verify response code
    sendReq.on('response', function(response) {
        if (response.statusCode !== 200) {
            return cb('Response status was ' + response.statusCode);
        }
    });

    // check for request errors
    sendReq.on('error', function (err) {
        fs.unlink(dest);
        return cb(err.message);
    });

    sendReq.pipe(file);

    file.on('finish', function() {
        file.close(cb);  // close() is async, call cb after close completes.
    });

    file.on('error', function(err) { // Handle errors
        fs.unlink(dest); // Delete the file async. (But we don't check the result)
        return cb(err.message);
    });
};

exports.dropbox_file_upload = function(dropbox, filePath, uploadPath, chunk_size) {
  chunk_size = chunk_size || 10 * 1024 * 1024; // 10MB
  const buffer = new Buffer(chunk_size);
  return new Promise(function(resolve, reject) {
    fs.open(filePath, 'r', function(err, fd) {
      if (err) throw err;
      function readNextChunk(upload_cursor) {
        fs.read(fd, buffer, 0, chunk_size, null, function(err, nread) {
          console.log('read chunk.');
          if (err) throw err;

          if (nread === 0) {
            // done reading file, do any necessary finalization steps
            dropbox.filesUploadSessionFinish({
                cursor: upload_cursor,
                commit: {
                            path: uploadPath,
                            mode: "overwrite",
                            autorename: true,
                            mute: false
                }
            }).then((file_meta_data)=>{
                console.log('upload finished:');
                // console.log(file_meta_data);
                resolve(file_meta_data);
            }).catch((err)=>{
                console.error('upload failed');
                // console.error(err);
                reject(err);
            });

            fs.close(fd, function(err) {
              if (err) throw err;
            });
            return;
          }

          var data;
          if (nread < chunk_size)
            data = buffer.slice(0, nread);
          else
            data = buffer;

          if(!upload_cursor){
            if(nread < chunk_size){
                dropbox.filesUpload({
                    contents:data,
                    path: uploadPath,
                    mode: "overwrite",
                    autorename: true,
                    mute: false
                }).then((file_meta_data)=>{
                    console.log('upload finished:');
                    //console.log(file_meta_data);
                    resolve(file_meta_data);
                }).catch((err)=>{
                    console.error('upload failed');
                    //console.error(err);
                    reject(err);
                });
            }
            else{
                dropbox.filesUploadSessionStart({contents: data, close: false}).then((cursor)=>{
                    console.log('upload started.');
                    upload_cursor = {session_id: cursor.session_id, offset: nread}
                    readNextChunk(upload_cursor);
                }).catch((err)=>{
                      console.error(err);
                  });
            }
          }
          else{
              dropbox.filesUploadSessionAppendV2({
                  contents:data,
                  cursor: upload_cursor,
                  close:false
              }).then(()=>{
                  console.log('uploading chunk.');
                  const new_upload_cursor = {
                      session_id: upload_cursor.session_id,
                      offset: upload_cursor.offset+nread
                  };
                  readNextChunk(new_upload_cursor);
              }).catch((err)=>{
                  console.error(err);
              });
          }
        });
      }
      readNextChunk();
    });
  });
};
