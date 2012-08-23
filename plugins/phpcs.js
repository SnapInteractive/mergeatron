var request = require('request');

exports.init = function(config, mergeatron) {
	mergeatron.on('artifact.found', function (build, pull, artifact) {
		if (artifact['relativePath'] == config.artifact) {
			process(build, pull, artifact['url']);
		}
	});

	function process(build, pull, artifact_url) {
		request({ url: artifact_url }, function(err, response) {
			if (err) {
				console.log(err);
				return;
			}

			var violations = parseCsvFile(response.body);
			pull.files.forEach(function(file, i) {
				if (file.status != 'modified' && file.status != 'added') {
					return;
				}

				violations.forEach(function(violation) {
					if (violation.file.indexOf(file.filename) == -1) {
						return;
					}

					var line_number = parseInt(violation.line);
					if (file.reported.indexOf(line_number) != -1) {
						return;
					}

					file.ranges.forEach(function(range) {
						if (line_number >= range[0] && line_number <= range[1]) {
							var diff_offset = range[3] + (line_number - range[0]) + 1;
							if (range[4] && range[4].length > 0) {
								range[4].forEach(function(deletion) {
									if (deletion <= line_number) {
										diff_offset += 1;
									}
								});
							}

							file.reported.push(line_number);
							mergeatron.emit('pull.inline_status', pull, file.sha, file.filename, diff_offset, violation.message);
							mergeatron.mongo.pulls.update({ _id: pull.number, 'files.filename': file.filename }, { $push: { 'files.$.reported': line_number }});
						}
					});
				});
			});
		});
	}

	function parseCsvFile(data, callback){
		var iteration = 0,
			header = [],
			records = [],
			pattern = /(?:^|,)("(?:[^"]+)*"|[^,]*)/g,
			parts = data.split('\n');

		for (var x in parts) {
			var line = parts[x];

			if (!line) {
				continue;
			}

			if (iteration++ == 0) {
				header = line.split(pattern);
			} else {
				records.push(buildRecord(line));
			}
		}

		function buildRecord(str){
			var record = {},
				fields = str.split(pattern);

			for (var y in fields) {
				if (header[y] != '') {
					record[header[y].toLowerCase()] = fields[y].replace(/"/g, '');
				}
			}

			return record;
		}

		return records;
	}
};