import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  ClientKafka,
  MessagePattern,
  Payload,
  Transport,
} from '@nestjs/microservices';
import { KAFKA_EVENTS, NAME_SERVICE_STARSHIP } from 'src/consts';
import {
  ComponentStatus,
  DataService,
  Starship,
  StarshipComponent,
} from 'src/data/data.service';
import { SocketsGateway } from '../sockets/sockets.gateway';
import { IncomingMessage } from '../types';

@Controller()
export class AppController {
  constructor(
    @Inject(NAME_SERVICE_STARSHIP) private kafkaClient: ClientKafka,
    private readonly dataService: DataService,
    private readonly socketsGateway: SocketsGateway,
  ) {}

  async onModuleInit() {
    const events = Object.values(KAFKA_EVENTS);

    await events.forEach(async (event) => {
      await this.kafkaClient.subscribeToResponseOf(event);
    });

    await this.kafkaClient.connect();
  }

  @Get('starships')
  getStarships(): Starship[] {
    return Object.values(this.dataService.getStarships());
  }

  @Delete('starships/:id')
  deleteStarship(@Param('id') id) {
    this.dataService.removeStarship(id);
    this.socketsGateway.onStarshipDeleted(id);
  }

  @Post('starships')
  createStarship(@Body() body: Omit<Starship, 'id'>): Omit<Starship, 'id'> {
    const { model, name } = body;

    const starship = {
      model,
      name,
    };

    this.kafkaClient.emit(KAFKA_EVENTS.EVENT_STARSHIP_CREATED, starship);

    return starship;
  }

  @MessagePattern(
    KAFKA_EVENTS.EVENT_STARSHIP_COMPONENT_CREATED,
    Transport.KAFKA,
  )
  StarshipComponentCreated(
    @Payload()
    payload: IncomingMessage<{
      component: StarshipComponent;
      starshipId: string;
    }>,
  ) {
    const { component, starshipId } = payload.value;

    setTimeout(() => {
      const starship = this.dataService.updateComponent(
        starshipId,
        component,
        ComponentStatus.complete,
      );

      if (starship) {
        this.socketsGateway.onComponentCreated(starship);
      }
    }, 1000 * Math.random() * 10);
  }

  @MessagePattern(KAFKA_EVENTS.EVENT_STARSHIP_CREATED, Transport.KAFKA)
  StarshipCreated(
    @Payload() payload: IncomingMessage<Omit<Starship, 'id'>>,
  ): any {
    const { name, model } = payload.value;
    const starship = this.dataService.createStarship({ name, model });

    Object.keys(StarshipComponent).map((component) =>
      this.kafkaClient.emit(KAFKA_EVENTS.EVENT_STARSHIP_COMPONENT_CREATED, {
        component,
        starshipId: starship.id,
      }),
    );

    this.socketsGateway.onStarshipCreated(starship);
  }
}