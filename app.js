var app = require('http').createServer(handler);
var io  = require('socket.io').listen(app);
var fs = require('fs');
var players = require('players');
var rooms = require('rooms');
var boxes = require('boxes');

var mysql      = require('mysql');
var config = JSON.parse(fs.readFileSync("./config.json"));
var connection = mysql.createConnection(config);

connection.connect();

app.listen(3000);

function handler (req, res) {
  res.writeHead(200);
  res.end("Koukou !");
}

const roomSize = 2;

var currentRoom = new rooms.Room(roomSize);

io.sockets.on('connection', function (socket) {
	var myRoom = currentRoom;
	socket.on('id', function (data) {
		connection.query("SELECT * FROM members WHERE phpsessid=?", data.id, function(err, rows, fields) {
			if (err) throw err;

			currentRoom.addPlayer(new players.Player(socket), rows[0]);

			socket.emit('connection', {color: currentRoom.getPlayer(socket).getColor(), pseudo: currentRoom.getPlayer(socket).getInfos().pseudo});

			if(currentRoom.isFull()) { 
				currentRoom = new rooms.Room(roomSize);
				myRoom.roomRequest('ready', {});
			} else {
				var roomToLoad = currentRoom;
				if(roomToLoad.getPowerList().length == 0) {
					connection.query("SELECT * FROM powers", function(err, rows, fields) {
						if (err) throw err;
						var powers = [];
						for(power in rows) {
							for(i=0;i<rows[power].weight;i++) {
								powers.push(rows[power].id);
							}
						}
						roomToLoad.setPowerList(powers);
					});
				}
			}

		});
	});

	socket.on('disconnect', function(){
		if(myRoom.isEnded()) {
			myRoom.roomRequest('server', {type: 1, code: 3, player: myRoom.getPlayer(socket).getInfos()});
		}
		else if(!myRoom.isFull() && !myRoom.isLaunched()) {
			if(myRoom.getPlayer(socket) != undefined) myRoom.discardPlayer(myRoom.getPlayer(socket));
		}
		else if(myRoom.isFull() && !myRoom.isLaunched()) {
			myRoom.roomRequest('server', {type: 1, code: 1, player: myRoom.getPlayer(socket).getInfos()});
			myRoom.stop();
		}
		else if(myRoom.isFull() && myRoom.isLaunched()) {
			myRoom.roomRequest('server', {type: 1, code: 2, player: myRoom.getPlayer(socket).getInfos()});
			myRoom.stop();
		}
	});

	socket.on('ready', function (data) {
		myRoom.getPlayer(socket).setReady(true);

		if(myRoom.isReady()) {
			setTimeout(function() { launchRoom(myRoom); }, 1000);
		}
	});

	socket.on('speak', function (data) {
		if(myRoom.getPlayer(socket) != undefined) myRoom.roomRequest('speak', {message:data.message, pseudo:myRoom.getPlayer(socket).getInfos().pseudo, color:myRoom.getPlayer(socket).getColor() });
	});

	socket.on('killbox', function (data) {
		if(!myRoom.getBox(data.id).isKilled()) {
			if(myRoom.getBox(data.id).getColor() == myRoom.getPlayer(socket).getColor()) {
				myRoom.getPlayer(socket).addPoints(1);
			} else if(myRoom.getBox(data.id).getColor() == myRoom.getMalus()) {
				myRoom.getPlayer(socket).rmPoints(3);
				if(myRoom.getPlayer(socket).getPoints() < 0) myRoom.getPlayer(socket).setPoints(0);
			} else if(myRoom.getBox(data.id).getColor() == myRoom.getBonus()) {
				myRoom.getPlayer(socket).givePower(myRoom.getBox(data.id).getPower());
				myRoom.getPlayer(socket).send('addpower', {box: data.id, power: myRoom.getBox(data.id).getPower()});
			} else {
				myRoom.getPlayer(socket).rmPoints(2);
				if(myRoom.getPlayer(socket).getPoints() < 0) myRoom.getPlayer(socket).setPoints(0);
			}

			myRoom.roomRequest('killbox', data);
			myRoom.getBox(data.id).kill();
		}
	});

	socket.on('attack', function (data) {
		if(myRoom.getPlayer(socket).hasPower(data.power)) {
			myRoom.otherPlayersRequest(socket, 'attack', {power: data.power});
			myRoom.getPlayer(socket).discardPower(data.power);
		}
	});
});

function launchRoom(room) {
	var playersInfos = [];
	for(player in room.getPlayers()) {
		objectPlayer = {pseudo: room.getPlayers()[player].getInfos().pseudo, color: room.getPlayers()[player].getColor()};
		playersInfos.push(objectPlayer);
	}
	room.roomRequest('start', playersInfos);

	setTimeout(function() { launchGame(room); }, 10000);
}

function launchGame(room) {
	room.setPowers(generatePowers(room));

	for(player in room.getPlayers()) {
		var power = room.getOnePower();
		room.getPlayers()[player].givePower(power);
		room.getPlayers()[player].send('addpower', {box: 'bonus', power: power});
	}

	var timesPower = [];

	for(i=0;i<room.getNbPowers();i++) {
		timesPower.push(5+Math.floor(Math.random() * 20));
	}
	timesPower.sort(compare);
	room.setTimesPower(timesPower);

	room.launch();

	stepGame(room);
}

function stepGame(room) {
	if(!room.isStopped()) {
		var blackRandom = Math.floor(Math.random() * 20);
		var power = false;

		if(room.getTime() >= room.getTimePower() && room.getNbPowers() > 0) {
			var stepColor = room.getBonus();
			power = room.getOnePower();
			room.changeTimePower();
		}
		else if(blackRandom == 0 && room.getNbBlack() < 5) var stepColor = room.getMalus();
		else {
			var stepColor = room.getCurrentColor();
			room.nextColor();
		}

		generateBox(room, stepColor, power);

		if(room.getTime()+2*room.getRatio() >= 30) {
			setTimeout(function() { endGame(room); }, 30-room.getTime());
			room.setTime(30);
		} else {
			setTimeout(function() { stepGame(room); }, 2*room.getRatio()*1000);
			room.setTime(room.getTime()+2*room.getRatio());
			room.nextRatio();
		}
	}
}

function endGame(room) {
	room.end();
	var points = [];
	var winner = room.getPlayers()[0];
	for(player in room.getPlayers()) {
		if(room.getPlayers()[player].getPoints() > winner.getPoints()) winner = room.getPlayers()[player];
		var noPowerState = 0;
		if(room.getPlayers()[player].getNoPowers()) noPowerState = 1;
		connection.query("UPDATE rankings SET points=points+?, noPower=noPower+?, nbPlayed=nbPlayed+1 WHERE member=?", [room.getPlayers()[player].getPoints(), noPowerState, room.getPlayers()[player].getInfos().id], function(err, rows, fields) {
			if (err) throw err;
		});
		points.push({pseudo: room.getPlayers()[player].getInfos().pseudo, points: room.getPlayers()[player].getPoints()});	
	}
	connection.query("UPDATE rankings SET nbWon=nbWon+1 WHERE member=?", winner.getInfos().id, function(err, rows, fields) {
		if (err) throw err;
	});
	room.roomRequest('stop', points);
}

function generateBox(room, stepColor, power) {
	var box = new boxes.Box(room.nextBox(), stepColor);
	room.addBox(box);
	box.setPower(power);
	room.roomRequest('box', {box: box});
	//console.log(box);
}

function generatePowers(room) {
	var powers = room.getPowerList();
	var selectedPowers = [];

	var nbPowers = 3+Math.floor(Math.random() * 4);

	for(i=0;i<nbPowers;i++) {
		var chosenPower = Math.floor(Math.random() * powers.length);
		selectedPowers.push(powers[chosenPower]);
	}

	return selectedPowers;
}

function compare(x, y) {
	return x - y;
}